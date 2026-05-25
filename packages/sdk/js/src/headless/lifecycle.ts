import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"

const SIGKILL_GRACE_MS = 300
const EXIT_WAIT_MS = 2_000
const STARTUP_TIMEOUT_MS = 10_000
const READY_LINE_PREFIX = "ax-code server listening on "

export type HeadlessBackendOptions = {
  directory?: string
  hostname?: string
  port?: number
  signal?: AbortSignal
  timeout?: number
  env?: Record<string, string>
  onStdout?: (line: string) => void
  onStderr?: (line: string) => void
  config?: Record<string, unknown>
  auth?: {
    username?: string
    password?: string
  }
  fetch?: typeof fetch
}

export type HeadlessBackendHandle = {
  url: string
  headers: Record<string, string>
  close(): Promise<void>
}

export async function startHeadlessBackend(options: HeadlessBackendOptions = {}): Promise<HeadlessBackendHandle> {
  const hostname = options.hostname ?? "127.0.0.1"
  const port = options.port ?? 0
  const timeout = options.timeout ?? STARTUP_TIMEOUT_MS
  const fetchFn = options.fetch ?? fetch

  const username = options.auth?.username ?? "ax-code"
  const password = options.auth?.password ?? randomBytes(24).toString("base64url")
  const authHeader = "Basic " + Buffer.from(`${username}:${password}`).toString("base64")
  const headers = { Authorization: authHeader }

  const args = ["serve", `--hostname=${hostname}`, `--port=${port}`]

  const proc = spawn("ax-code", args, {
    cwd: options.directory,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      ...options.env,
      AX_CODE_SERVER_PASSWORD: password,
      AX_CODE_SERVER_USERNAME: username,
      ...(options.directory ? { AX_CODE_PROJECT: options.directory } : {}),
      ...(options.config ? { AX_CODE_CONFIG_CONTENT: JSON.stringify(options.config) } : {}),
    },
  })

  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      failStartup(
        new Error(`ax-code backend did not become ready within ${timeout}ms\nCaptured output:\n${capturedOutput}`),
      )
    }, timeout)

    let capturedOutput = ""
    let settled = false
    let stdoutBuf = ""

    const onReadyUrl = (urlStr: string) => {
      void waitForBackendHealth({
        url: urlStr,
        headers,
        fetch: fetchFn,
      }).then(
        () => succeed(urlStr),
        (error) => failStartup(error instanceof Error ? error : new Error(String(error))),
      )
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
      clearTimeout(timer)
      cleanup()
      void killProc(proc)
        .catch(() => undefined)
        .finally(() => reject(error))
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
          const urlStr = line.slice(READY_LINE_PREFIX.length).trim()
          onReadyUrl(urlStr)
        }
      }
    }

    const onStderr = (chunk: Buffer) => {
      const text = chunk.toString()
      capturedOutput += text
      for (const line of text.split("\n")) {
        if (line.trim()) options.onStderr?.(line)
      }
    }

    const onError = (err: Error) => {
      failStartup(new Error(`ax-code backend failed to start: ${err.message}`))
    }

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      const reason = signal ? `signal ${signal}` : `code ${code}`
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
    url,
    headers,
    async close() {
      await killProc(proc)
    },
  }
}

async function waitForBackendHealth(input: { url: string; headers: Record<string, string>; fetch: typeof fetch }) {
  const response = await input.fetch(new URL("/global/health", input.url), {
    method: "GET",
    headers: input.headers,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`ax-code backend health check failed (${response.status}): ${text || response.statusText}`)
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
