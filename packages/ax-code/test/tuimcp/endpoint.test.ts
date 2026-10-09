import { describe, expect, test } from "vitest"
import fs from "node:fs/promises"
import net from "node:net"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { createTuiMcpController } from "../../src/tuimcp/controller"
import type { LiveState } from "../../src/tuimcp/controller"
import {
  assertTuiMcpPlatform,
  callTuiMcpEndpoint,
  readTuiMcpEndpoint,
  startTuiMcpEndpoint,
} from "../../src/tuimcp/endpoint"
import { MAX_FRAME_BYTES } from "../../src/tuimcp/protocol"
import { parseJsonStrict } from "../../src/util/json-value"
import { SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

async function fixture(validate?: (signal: AbortSignal) => Promise<void>, onClose?: () => void) {
  const state: LiveState = { workspace: "/private/workspace", route: "home", ready: true, blocked: false }
  let navigations = 0
  const controller = createTuiMcpController({
    state: () => state,
    validateSession: async (_, signal) => {
      await validate?.(signal)
    },
    navigate: (sessionId) => {
      navigations++
      state.route = "session"
      state.sessionId = sessionId
    },
  })
  const endpoint = await startTuiMcpEndpoint(controller, onClose)
  const view = controller.context()
  return {
    controller,
    endpoint,
    navigations: () => navigations,
    request: {
      operation: "select_session" as const,
      requestId: randomUUID(),
      instanceId: view.instanceId,
      generation: view.generation,
      expectedRevision: view.revision,
      sessionId: SessionID.ascending(),
    },
    [Symbol.asyncDispose]: () => endpoint.close(),
  }
}
async function raw(filename: string, body: string) {
  return new Promise<unknown>((resolve, reject) => {
    const socket = net.createConnection(path.join(path.dirname(filename), "s"))
    let output = ""
    socket.setTimeout(2_000, () => {
      socket.destroy()
      reject(new Error("No socket response"))
    })
    socket.on("error", reject)
    socket.on("connect", () => socket.write(body))
    socket.on("data", (data) => {
      output += data.toString()
      if (!output.includes("\n")) return
      socket.destroy()
      resolve(parseJsonStrict(output.trim()))
    })
  })
}

describe.skipIf(process.platform === "win32")("TUIMCP private socket", () => {
  test("cleans the private endpoint even when its close callback throws", async () => {
    const f = await fixture(undefined, () => {
      throw new Error("Close callback failed")
    })
    try {
      await expect(f.endpoint.close()).rejects.toThrow("Close callback failed")
      await expect(fs.stat(path.dirname(f.endpoint.filename))).rejects.toMatchObject({ code: "ENOENT" })
      expect(
        await f.controller.dispatch({ operation: "get_view_context" }, new AbortController().signal),
      ).toMatchObject({
        code: "revoked",
      })
    } finally {
      await f.endpoint.close().catch(() => {})
    }
  })

  test("concurrent and reentrant close calls await the same completed cleanup", async () => {
    let nested: Promise<void> | undefined
    const f = await fixture(undefined, () => {
      nested = f.endpoint.close()
    })
    const first = f.endpoint.close()
    const second = f.endpoint.close()
    await Promise.all([first, second])
    expect(second).toBe(first)
    expect(nested).toBe(first)
    await expect(fs.stat(path.dirname(f.endpoint.filename))).rejects.toMatchObject({ code: "ENOENT" })
  })

  test("uses private modes and acknowledges actual route state", async () => {
    await using f = await fixture()
    const file = f.endpoint.filename
    expect((await fs.stat(path.dirname(file))).mode & 0o777).toBe(0o700)
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
    expect((await fs.stat(path.join(path.dirname(file), "s"))).mode & 0o777).toBe(0o600)
    expect(await callTuiMcpEndpoint(file, { operation: "get_view_context" })).toMatchObject({
      status: "context",
      context: { route: "home" },
    })
    expect(await callTuiMcpEndpoint(file, f.request)).toMatchObject({
      status: "applied",
      context: { sessionId: f.request.sessionId },
    })
    expect(await callTuiMcpEndpoint(file, f.request)).toMatchObject({ status: "applied" })
    expect(f.navigations()).toBe(1)
  })
  test("two live TUIs never broadcast or guess a target", async () => {
    await using a = await fixture()
    await using b = await fixture()
    expect(await callTuiMcpEndpoint(b.endpoint.filename, a.request)).toMatchObject({ code: "stale_target" })
    expect(a.navigations()).toBe(0)
    expect(b.navigations()).toBe(0)
    await callTuiMcpEndpoint(a.endpoint.filename, a.request)
    expect(a.navigations()).toBe(1)
    expect(b.navigations()).toBe(0)
  })
  test("authenticates every request and bounds frames", async () => {
    await using f = await fixture()
    const auth = await readTuiMcpEndpoint(f.endpoint.filename)
    expect(
      await raw(
        f.endpoint.filename,
        JSON.stringify({ token: "0".repeat(64), request: { operation: "get_view_context" } }) + "\n",
      ),
    ).toMatchObject({ code: "unauthorized" })
    expect(await raw(f.endpoint.filename, "{bad json}\n")).toMatchObject({ code: "invalid_request" })
    expect(await raw(f.endpoint.filename, "x".repeat(MAX_FRAME_BYTES + 1))).toMatchObject({ code: "invalid_request" })
    const frame = JSON.stringify({ token: auth.token, request: { operation: "get_view_context" } }) + "\n"
    expect(await raw(f.endpoint.filename, frame + frame)).toMatchObject({ code: "invalid_request" })
  })
  test.each(["directory", "file", "socket"])("rejects unsafe %s permissions", async (kind) => {
    await using f = await fixture()
    const name =
      kind === "directory"
        ? path.dirname(f.endpoint.filename)
        : kind === "file"
          ? f.endpoint.filename
          : path.join(path.dirname(f.endpoint.filename), "s")
    await fs.chmod(name, 0o777)
    await expect(readTuiMcpEndpoint(f.endpoint.filename)).rejects.toThrow("private")
  })
  test("rejects relative paths, symlink files and symlink directory components", async () => {
    await using f = await fixture()
    await using tmp = await tmpdir()
    await expect(readTuiMcpEndpoint("endpoint.json")).rejects.toThrow("absolute")
    const alias = path.join(tmp.path, "alias")
    await fs.symlink(path.dirname(f.endpoint.filename), alias)
    await expect(readTuiMcpEndpoint(path.join(alias, "endpoint.json"))).rejects.toThrow("symlinks")
    const fileAlias = path.join(tmp.path, "endpoint.json")
    await fs.symlink(f.endpoint.filename, fileAlias)
    await expect(readTuiMcpEndpoint(fileAlias)).rejects.toThrow("symlinks")
  })
  test("disconnect/timeout cancels pending commit without retry", async () => {
    let release!: () => void
    const lookup = new Promise<void>((resolve) => {
      release = resolve
    })
    await using f = await fixture(() => lookup)
    const result = await callTuiMcpEndpoint(f.endpoint.filename, f.request, { timeoutMs: 30 })
    expect(result).toMatchObject({ code: "timeout_unknown" })
    // Give the server the close event before simulating a late SDK response.
    await new Promise((resolve) => setTimeout(resolve, 30))
    release()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(f.navigations()).toBe(0)
  })
  test("revocation closes the endpoint and aborts pending work", async () => {
    let release!: () => void
    const lookup = new Promise<void>((resolve) => {
      release = resolve
    })
    let reached!: () => void
    const started = new Promise<void>((resolve) => {
      reached = resolve
    })
    const f = await fixture(async () => {
      reached()
      await lookup
    })
    const pending = callTuiMcpEndpoint(f.endpoint.filename, f.request)
    await started
    await f.endpoint.close()
    expect(await pending).toMatchObject({ code: "timeout_unknown" })
    release()
    await Promise.resolve()
    expect(f.navigations()).toBe(0)
    await expect(fs.stat(f.endpoint.filename)).rejects.toThrow()
  })
  test("cancelled calls do not navigate", async () => {
    await using f = await fixture()
    const abort = new AbortController()
    abort.abort()
    expect(await callTuiMcpEndpoint(f.endpoint.filename, f.request, { signal: abort.signal })).toMatchObject({
      code: "cancelled",
    })
    expect(f.navigations()).toBe(0)
  })
})

test("Windows fails explicitly instead of opening an unqualified pipe", () => {
  expect(() => assertTuiMcpPlatform("win32")).toThrow("POSIX")
})
