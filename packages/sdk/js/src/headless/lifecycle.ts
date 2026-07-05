import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { realpathSync } from "node:fs"
import { access } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assertSdkHttpLoopbackBind, resolveSpawnCommand } from "../internal/server-shared.js"
import { withDirectoryHeaders } from "../protocol.js"
import { createIpcTransport } from "./ipc-transport.js"

const SIGKILL_GRACE_MS = 300
const EXIT_WAIT_MS = 2_000
const STARTUP_TIMEOUT_MS = 10_000
const READY_LINE_PREFIX = "ax-code server listening on "
const IPC_READY_LINE_PREFIX = "ax-code server ipc listening on "

export type HeadlessBackendTransport = "http-sse" | "ipc"

export type HeadlessBackendOptions = {
  directory?: string
  hostname?: string
  port?: number
  /**
   * Executable used to start the backend. Defaults to `ax-code`.
   * App shells can pass an absolute binary path while keeping the SDK-owned
   * readiness, auth, diagnostics, and shutdown behavior.
   */
  binary?: string
  /**
   * Full argument vector for the backend executable. When omitted, the SDK
   * launches `ax-code serve --hostname=<host> --port=<port>`.
   */
  args?: string[]
  /**
   * Transport used to talk to the backend. `"http-sse"` keeps the legacy
   * loopback HTTP behavior; `"ipc"` uses a local Unix domain socket.
   */
  transport?: HeadlessBackendTransport
  /**
   * Explicit path for the Unix domain socket when `transport` is `"ipc"`.
   * When omitted, a unique path under the system temp directory is generated.
   */
  ipcSocketPath?: string
  /**
   * HTTP headless backend helpers are desktop compatibility fallbacks.
   * Network binds must be explicit so GUI apps do not accidentally expose the full HTTP API.
   */
  allowNetworkBind?: boolean
  signal?: AbortSignal
  timeout?: number
  env?: Record<string, string>
  onStdout?: (line: string) => void
  onStderr?: (line: string) => void
  /** @internal test seam for environments where loopback bind is sandboxed. */
  reservePort?: (hostname: string) => Promise<number>
  config?: Record<string, unknown>
  auth?: {
    username?: string
    password?: string
  }
  fetch?: typeof fetch
}

export type HeadlessBackendDiagnostics = {
  launchedAt: string
  binary: string
  args: string[]
  cwd?: string
  hostname: string
  port: number
  socketPath?: string
  authUsername: string
  envKeys: string[]
  readyUrl?: string
  health?: {
    ok: boolean
    status: number
    body?: unknown
    error?: string
  }
  exit?: {
    code: number | null
    signal: NodeJS.Signals | null
    beforeReady: boolean
  }
  capturedOutput?: string
}

export type HeadlessBackendHandle = {
  url: string
  socketPath?: string
  headers: Record<string, string>
  diagnostics: HeadlessBackendDiagnostics
  closed: Promise<void>
  close(): Promise<void>
}

export class HeadlessBackendStartupError extends Error {
  readonly diagnostics: HeadlessBackendDiagnostics

  constructor(message: string, diagnostics: HeadlessBackendDiagnostics, options?: ErrorOptions) {
    super(message, options)
    this.name = "HeadlessBackendStartupError"
    this.diagnostics = diagnostics
  }
}

export async function startHeadlessBackend(options: HeadlessBackendOptions = {}): Promise<HeadlessBackendHandle> {
  const transport = options.transport ?? "http-sse"
  const hostname = options.hostname ?? "127.0.0.1"
  assertSdkHttpLoopbackBind(hostname, options.allowNetworkBind, "startHeadlessBackend")

  const username = options.auth?.username ?? "ax-code"
  const password = options.auth?.password ?? randomBytes(24).toString("base64url")
  const authHeader = "Basic " + Buffer.from(`${username}:${password}`).toString("base64")
  const headers = options.directory
    ? withDirectoryHeaders({ Authorization: authHeader }, options.directory)
    : { Authorization: authHeader }

  let socketPath: string | undefined
  let port = options.port ?? 0
  if (transport === "ipc") {
    socketPath = options.ipcSocketPath ?? generateIpcSocketPath()
    // The runtime still starts an HTTP listener for readiness probes and
    // backward compatibility; binding to port 0 lets the OS allocate one.
    port = 0
  }

  const reservePort = options.reservePort ?? reserveLoopbackPort
  if (transport === "http-sse" && port === 0) {
    port = await reservePort(hostname).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to reserve loopback port for ax-code backend on ${hostname}: ${message}`, {
        cause: error,
      })
    })
  }

  const timeout = options.timeout ?? STARTUP_TIMEOUT_MS
  const fetchFn = options.fetch ?? fetch

  const binary = options.binary?.trim() || "ax-code"
  const args =
    options.args ??
    (transport === "ipc"
      ? ["serve", `--ipc-socket=${socketPath}`, `--port=${port}`]
      : ["serve", `--hostname=${hostname}`, `--port=${port}`])
  const diagnostics: HeadlessBackendDiagnostics = {
    launchedAt: new Date().toISOString(),
    binary,
    args: [...args],
    cwd: options.directory,
    hostname,
    port,
    socketPath,
    authUsername: username,
    envKeys: Object.keys(options.env ?? {}).sort(),
  }
  const env = {
    ...process.env,
    ...options.env,
    AX_CODE_SERVER_PASSWORD: password,
    AX_CODE_SERVER_USERNAME: username,
    ...(options.directory ? { AX_CODE_PROJECT: options.directory } : {}),
    ...(options.config ? { AX_CODE_CONFIG_CONTENT: JSON.stringify(options.config) } : {}),
  }

  const proc = spawn(resolveSpawnCommand(binary, env), args, {
    cwd: options.directory,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    env,
  })
  const closed = new Promise<void>((resolve) => {
    proc.once("exit", () => resolve())
    proc.once("error", () => resolve())
  })

  const ready = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      failStartup(
        new Error(`ax-code backend did not become ready within ${timeout}ms\nCaptured output:\n${capturedOutput}`),
      )
    }, timeout)

    let capturedOutput = ""
    let settled = false
    let stdoutBuf = ""
    let stderrBuf = ""

    const onReadyUrl = (urlStr: string) => {
      diagnostics.readyUrl = urlStr
      void waitForBackendHealth({
        url: urlStr,
        headers,
        fetch: fetchFn,
      }).then(
        (health) => {
          diagnostics.health = health
          succeed(urlStr)
        },
        (error) => {
          const message = error instanceof Error ? error.message : String(error)
          diagnostics.health = {
            ok: false,
            status: 0,
            error: message,
          }
          failStartup(error instanceof Error ? error : new Error(message))
        },
      )
    }

    const onReadySocket = async (socketPathStr: string) => {
      diagnostics.readyUrl = `ipc://${socketPathStr}`
      const health = await waitForBackendIpcHealth({
        socketPath: socketPathStr,
        directory: options.directory,
        experimental_workspaceID: undefined,
        headers,
      }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false as const, status: 0, error: message }
      })
      diagnostics.health = health
      if (!health.ok) {
        failStartup(new Error(health.error ?? "IPC backend health check failed"))
        return
      }
      succeed(`ipc://${socketPathStr}`)
    }

    const succeed = (url: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      cleanup()
      resolve(url)
    }

    const failStartup = (error: Error) => {
      if (settled) return
      settled = true
      diagnostics.capturedOutput = capturedOutput + stdoutBuf
      clearTimeout(timer)
      cleanup()
      const startupError =
        error instanceof HeadlessBackendStartupError
          ? error
          : new HeadlessBackendStartupError(error.message, diagnostics, { cause: error })
      void killProc(proc)
        .catch(() => undefined)
        .finally(() => reject(startupError))
    }

    const onAbort = () => {
      failStartup(new Error("startHeadlessBackend aborted"))
    }

    const cleanup = () => {
      options.signal?.removeEventListener("abort", onAbort)
      proc.stdout?.off("data", onStdout)
      proc.stderr?.off("data", onStderr)
      proc.off("error", onError)
      proc.off("exit", onExit)
    }

    const onStdout = (chunk: Buffer) => {
      stdoutBuf += chunk.toString()
      const lines = stdoutBuf.split("\n")
      stdoutBuf = lines.pop() ?? ""
      for (const line of lines) {
        capturedOutput += line + "\n"
        options.onStdout?.(line)
        if (line.startsWith(READY_LINE_PREFIX)) {
          if (transport === "ipc") continue
          const urlStr = line.slice(READY_LINE_PREFIX.length).trim()
          onReadyUrl(urlStr)
        } else if (line.startsWith(IPC_READY_LINE_PREFIX)) {
          const socketPathStr = line.slice(IPC_READY_LINE_PREFIX.length).trim()
          void onReadySocket(socketPathStr)
        }
      }
    }

    const onStderr = (chunk: Buffer) => {
      const text = chunk.toString()
      capturedOutput += text
      stderrBuf += text
      const lines = stderrBuf.split("\n")
      stderrBuf = lines.pop() ?? ""
      for (const line of lines) {
        if (line.trim()) options.onStderr?.(line)
      }
    }

    const onError = (err: Error) => {
      failStartup(new Error(`ax-code backend failed to start: ${err.message}`))
    }

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      const reason = signal ? `signal ${signal}` : `code ${code}`
      diagnostics.exit = { code, signal, beforeReady: !settled }
      failStartup(
        new Error(`ax-code backend exited before becoming ready (${reason})\nCaptured output:\n${capturedOutput}`),
      )
    }

    options.signal?.addEventListener("abort", onAbort, { once: true })
    if (options.signal?.aborted) {
      failStartup(new Error("startHeadlessBackend aborted"))
      return
    }

    proc.stdout?.on("data", onStdout)
    proc.stderr?.on("data", onStderr)
    proc.once("error", onError)
    proc.once("exit", onExit)
  })

  return {
    url: ready,
    socketPath,
    headers,
    diagnostics,
    closed,
    async close() {
      await killProc(proc)
    },
  }
}

async function reserveLoopbackPort(hostname: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.unref()

    const cleanup = () => {
      server.off("error", onError)
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }

    server.once("error", onError)
    server.listen(0, hostname, () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : undefined
      server.close((error) => {
        cleanup()
        if (error) {
          reject(error)
          return
        }
        if (!port) {
          reject(new Error("Failed to reserve a loopback port for ax-code backend"))
          return
        }
        resolve(port)
      })
    })
  })
}

async function waitForBackendHealth(input: {
  url: string
  headers: Record<string, string>
  fetch: typeof fetch
}): Promise<HeadlessBackendDiagnostics["health"]> {
  const response = await input.fetch(new URL("/global/health", input.url), {
    method: "GET",
    headers: input.headers,
  })
  const contentType = response.headers.get("content-type") ?? ""
  const body = contentType.includes("application/json")
    ? await response.json().catch(() => undefined)
    : await response.text().catch(() => undefined)
  if (!response.ok) {
    const text = typeof body === "string" ? body : body === undefined ? "" : JSON.stringify(body)
    throw new Error(`ax-code backend health check failed (${response.status}): ${text || response.statusText}`)
  }
  return {
    ok: true,
    status: response.status,
    body,
  }
}

async function waitForBackendIpcHealth(input: {
  socketPath: string
  directory?: string
  experimental_workspaceID?: string
  headers?: Record<string, string>
}): Promise<Exclude<HeadlessBackendDiagnostics["health"], undefined>> {
  await access(input.socketPath).catch(() => {
    throw new Error(`IPC socket file does not exist: ${input.socketPath}`)
  })
  const transport = createIpcTransport({
    socketPath: input.socketPath,
    directory: input.directory,
    experimental_workspaceID: input.experimental_workspaceID,
    headers: input.headers,
  })
  try {
    const body = await transport.requestJson<unknown>({ path: "/global/health", method: "GET" })
    return { ok: true, status: 200, body }
  } finally {
    await transport.close?.()
  }
}

function generateIpcSocketPath(): string {
  const random = randomBytes(8).toString("hex")
  return join(canonicalTmpdir(), `ax-code-ipc-${random}.sock`)
}

function canonicalTmpdir(): string {
  try {
    return realpathSync(tmpdir())
  } catch {
    return tmpdir()
  }
}

async function killProc(proc: ReturnType<typeof spawn>): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return
  return new Promise<void>((resolve) => {
    let done = false
    let forceKill: ReturnType<typeof setTimeout> | undefined
    let giveUp: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      if (done) return
      done = true
      if (forceKill) clearTimeout(forceKill)
      if (giveUp) clearTimeout(giveUp)
      resolve()
    }
    proc.once("exit", finish)
    try {
      signalProcessTree(proc, "SIGTERM")
    } catch {
      finish()
      return
    }
    forceKill = setTimeout(() => {
      try {
        signalProcessTree(proc, "SIGKILL")
      } catch {}
    }, SIGKILL_GRACE_MS)
    giveUp = setTimeout(finish, EXIT_WAIT_MS)
  })
}

function signalProcessTree(proc: ReturnType<typeof spawn>, signal: NodeJS.Signals) {
  if (process.platform === "win32" && proc.pid) {
    try {
      const args = ["/pid", String(proc.pid), "/T"]
      if (signal === "SIGKILL") args.push("/F")
      spawn("taskkill", args, { stdio: "ignore" })
      return
    } catch {}
  }
  if (process.platform !== "win32" && proc.pid) {
    try {
      process.kill(-proc.pid, signal)
      return
    } catch {}
  }
  proc.kill(signal)
}
