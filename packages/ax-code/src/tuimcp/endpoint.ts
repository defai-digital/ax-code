import fs from "node:fs/promises"
import { constants } from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { randomBytes, timingSafeEqual } from "node:crypto"
import z from "zod"
import { parseJsonStrict } from "@/util/json-value"
import { CALL_TIMEOUT_MS, EndpointSchema, MAX_FRAME_BYTES, RequestSchema, ResultSchema, reject } from "./protocol"
import type { Endpoint, Request, Result } from "./protocol"
import type { TuiMcpController } from "./controller"

export function assertTuiMcpPlatform(platform = process.platform) {
  if (platform === "win32" || !process.getuid) throw new Error("TUIMCP currently supports POSIX private sockets only")
}

async function checkPrivate(target: string, kind: "directory" | "file" | "socket") {
  const stat = await fs.lstat(target)
  const valid = kind === "directory" ? stat.isDirectory() : kind === "file" ? stat.isFile() : stat.isSocket()
  const mode = kind === "directory" ? 0o700 : 0o600
  if (!valid || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== mode) {
    throw new Error("TUIMCP endpoint must be private and owned by the current user")
  }
}

export async function readTuiMcpEndpoint(filename: string): Promise<Endpoint> {
  assertTuiMcpPlatform()
  if (!path.isAbsolute(filename) || path.basename(filename) !== "endpoint.json") {
    throw new Error("TUIMCP requires an absolute endpoint.json path")
  }
  if ((await fs.realpath(filename)) !== filename) throw new Error("TUIMCP endpoint must not contain symlinks")
  await checkPrivate(path.dirname(filename), "directory")
  await checkPrivate(filename, "file")
  await checkPrivate(path.join(path.dirname(filename), "s"), "socket")
  const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await handle.stat()
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o777) !== 0o600 ||
      stat.size > MAX_FRAME_BYTES
    ) {
      throw new Error("Invalid TUIMCP endpoint file")
    }
    return EndpointSchema.parse(parseJsonStrict(await handle.readFile("utf8")))
  } finally {
    await handle.close()
  }
}

export async function startTuiMcpEndpoint(controller: TuiMcpController, onClose?: () => void) {
  assertTuiMcpPlatform()
  const root = await fs.realpath(os.tmpdir())
  const directory = await fs.mkdtemp(path.join(root, "ax-tui-"))
  await fs.chmod(directory, 0o700)
  const socketPath = path.join(directory, "s")
  const filename = path.join(directory, "endpoint.json")
  const endpoint: Endpoint = {
    version: 1,
    instanceId: controller.instanceId,
    generation: controller.generation,
    token: randomBytes(32).toString("hex"),
  }
  const sockets = new Set<net.Socket>()
  let closed = false
  let closePromise: Promise<void> | undefined
  const server = net.createServer((socket) => {
    if (closed || sockets.size >= 16) {
      socket.destroy()
      return
    }
    sockets.add(socket)
    const abort = new AbortController()
    let buffer = Buffer.alloc(0)
    let received = false
    const deadline = setTimeout(() => socket.destroy(), CALL_TIMEOUT_MS + 1_000)
    socket.on("error", () => socket.destroy())
    socket.on("close", () => {
      clearTimeout(deadline)
      sockets.delete(socket)
      abort.abort()
    })
    const respond = (result: Result) => {
      if (!socket.destroyed) socket.end(JSON.stringify(result) + "\n")
    }
    socket.on("data", (chunk: Buffer) => {
      if (received) {
        socket.destroy()
        return
      }
      if (buffer.length + chunk.length > MAX_FRAME_BYTES) {
        received = true
        respond(reject("invalid_request"))
        return
      }
      buffer = Buffer.concat([buffer, chunk])
      const newline = buffer.indexOf(10)
      if (newline < 0) return
      received = true
      if (newline !== buffer.length - 1) {
        respond(reject("invalid_request"))
        return
      }
      const parsed = z
        .object({ token: z.string().regex(/^[a-f0-9]{64}$/), request: RequestSchema })
        .strict()
        .safeParse(
          (() => {
            try {
              return parseJsonStrict(buffer.subarray(0, newline).toString("utf8"))
            } catch {
              return undefined
            }
          })(),
        )
      if (!parsed.success) {
        respond(reject("invalid_request"))
        return
      }
      if (!timingSafeEqual(Buffer.from(parsed.data.token), Buffer.from(endpoint.token))) {
        respond(reject("unauthorized"))
        return
      }
      void controller
        .dispatch(parsed.data.request, abort.signal)
        .then(respond)
        .catch(() => respond(reject("internal_error")))
    })
  })
  try {
    // Unix sockaddr_un limits differ by platform. Use a conservative byte cap.
    if (Buffer.byteLength(socketPath) >= 100)
      throw new Error("TUIMCP temporary socket path is too long; use a shorter TMPDIR")
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(socketPath, () => {
        server.removeListener("error", reject)
        resolve()
      })
    })
    await fs.chmod(socketPath, 0o600)
    await fs.writeFile(filename, JSON.stringify(endpoint) + "\n", { mode: 0o600, flag: "wx" })
  } catch (error) {
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
    throw error
  }
  function close(): Promise<void> {
    if (closePromise) return closePromise
    closed = true
    closePromise = Promise.resolve().then(async () => {
      try {
        controller.dispose()
        onClose?.()
      } finally {
        for (const socket of sockets) socket.destroy()
        await new Promise<void>((resolve) => server.close(() => resolve()))
        await fs.rm(directory, { recursive: true, force: true })
      }
    })
    return closePromise
  }
  // Fail closed and release the listener and capability on runtime errors.
  server.on("error", () => {
    void close().catch((error) => process.stderr.write(`TUIMCP cleanup failed: ${String(error)}\n`))
  })
  return { filename, close }
}

/** One RPC, one connection; no retry after a possibly applied action. */
export async function callTuiMcpEndpoint(
  filename: string,
  request: Request,
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<Result> {
  const endpoint = await readTuiMcpEndpoint(filename)
  if (
    request.operation === "select_session" &&
    (request.instanceId !== endpoint.instanceId || request.generation !== endpoint.generation)
  )
    return reject("stale_target")
  const payload = Buffer.from(JSON.stringify({ token: endpoint.token, request: RequestSchema.parse(request) }) + "\n")
  if (payload.length > MAX_FRAME_BYTES) return reject("invalid_request")
  return new Promise<Result>((resolve) => {
    if (options?.signal?.aborted) {
      resolve(reject("cancelled"))
      return
    }
    const socket = net.createConnection(path.join(path.dirname(filename), "s"))
    let buffer = Buffer.alloc(0)
    let settled = false
    let sent = false
    const finish = (result: Result) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      options?.signal?.removeEventListener("abort", cancel)
      socket.destroy()
      resolve(result)
    }
    const cancel = () =>
      finish(reject(sent ? "timeout_unknown" : options?.signal?.aborted ? "cancelled" : "target_unavailable"))
    options?.signal?.addEventListener("abort", cancel, { once: true })
    const deadline = setTimeout(cancel, options?.timeoutMs ?? CALL_TIMEOUT_MS + 500)
    socket.on("connect", () => {
      sent = true
      socket.write(payload)
    })
    socket.on("error", cancel)
    socket.on("close", cancel)
    socket.on("data", (chunk: Buffer) => {
      if (buffer.length + chunk.length > MAX_FRAME_BYTES) {
        finish(reject("invalid_request"))
        return
      }
      buffer = Buffer.concat([buffer, chunk])
      const newline = buffer.indexOf(10)
      if (newline < 0) return
      try {
        if (newline !== buffer.length - 1) throw new Error("Multiple TUIMCP responses")
        const result = ResultSchema.parse(parseJsonStrict(buffer.subarray(0, newline).toString("utf8")))
        if (
          result.status !== "rejected" &&
          (result.context.instanceId !== endpoint.instanceId || result.context.generation !== endpoint.generation)
        ) {
          finish(reject("stale_target"))
          return
        }
        finish(result)
      } catch {
        finish(reject("invalid_request"))
      }
    })
  })
}
