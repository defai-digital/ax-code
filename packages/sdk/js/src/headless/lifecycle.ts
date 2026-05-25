import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"

const SIGKILL_GRACE_MS = 300
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

  const username = "ax-code"
  const password = randomBytes(24).toString("base64url")
  const authHeader = "Basic " + Buffer.from(`${username}:${password}`).toString("base64")

  const args = ["serve", `--hostname=${hostname}`, `--port=${port}`]

  const proc = spawn("ax-code", args, {
    stdio: ["ignore", "pipe", "pipe"],
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
      void killProc(proc).catch(() => undefined)
      reject(error)
    }

    const onAbort = () => {
      failStartup(new Error("startHeadlessBackend aborted"))
    }

    const cleanup = () => {
      options.signal?.removeEventListener("abort", onAbort)
    }

    options.signal?.addEventListener("abort", onAbort, { once: true })
    if (options.signal?.aborted) {
      failStartup(new Error("startHeadlessBackend aborted"))
      return
    }

    let stdoutBuf = ""
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString()
      const lines = stdoutBuf.split("\n")
      stdoutBuf = lines.pop() ?? ""
      for (const line of lines) {
        capturedOutput += line + "\n"
        options.onStdout?.(line)
        if (line.startsWith(READY_LINE_PREFIX)) {
          const urlStr = line.slice(READY_LINE_PREFIX.length).trim()
          succeed(urlStr)
        }
      }
    })

    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      capturedOutput += text
      for (const line of text.split("\n")) {
        if (line.trim()) options.onStderr?.(line)
      }
    })

    proc.once("error", (err) => {
      failStartup(new Error(`ax-code backend failed to start: ${err.message}`))
    })

    proc.once("exit", (code, signal) => {
      const reason = signal ? `signal ${signal}` : `code ${code}`
      failStartup(
        new Error(`ax-code backend exited before becoming ready (${reason})\nCaptured output:\n${capturedOutput}`),
      )
    })
  })

  return {
    url,
    headers: { Authorization: authHeader },
    async close() {
      await killProc(proc)
    },
  }
}

async function killProc(proc: ReturnType<typeof spawn>): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return
  return new Promise<void>((resolve) => {
    proc.once("exit", () => resolve())
    try {
      proc.kill("SIGTERM")
    } catch {
      resolve()
      return
    }
    const forceKill = setTimeout(() => {
      try {
        proc.kill("SIGKILL")
      } catch {}
    }, SIGKILL_GRACE_MS)
    proc.once("exit", () => {
      clearTimeout(forceKill)
      resolve()
    })
  })
}
