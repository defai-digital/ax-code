import { type ChildProcess } from "node:child_process"
import { constants, accessSync } from "node:fs"
import path from "node:path"

/**
 * Shared utilities for SDK server lifecycle modules.
 *
 * Both v1 (`src/server.ts`) and v2 (`src/v2/server.ts`) import from here
 * to avoid duplicating the Proc type augmentation, loopback-bind guard,
 * graceful-process-shutdown, and server-ready detection logic.
 *
 * Type definitions (ServerOptions, TuiOptions) stay in each version's
 * server module because the `config` field references version-specific
 * generated Config types.
 */

/**
 * Augmented ChildProcess type with strongly-typed exit/error event
 * overloads. Node's built-in ChildProcess types lack these specific
 * overloads, so we declare them explicitly for the SDK server lifecycle.
 */
export type Proc = ChildProcess & {
  on(event: "exit", listener: (code: number | null) => void): ChildProcess
  on(event: "error", listener: (error: Error) => void): ChildProcess
  once(event: "exit", listener: (code: number | null) => void): ChildProcess
}

const DEFAULT_HOSTNAME = "127.0.0.1"
const DEFAULT_PORT = 4096
const DEFAULT_TIMEOUT = 5000
const READY_LINE_PATTERN = /ax-code server listening\s+on\s+(https?:\/\/[^\s]+)/
const SIGTERM_KILL_GRACE_MS = 300
const SIGKILL_GIVE_UP_MS = 2_000

/**
 * Merge caller-supplied server options with defaults and validate the
 * loopback bind constraint. The `config` field is intentionally typed
 * loosely here — each version's `ServerOptions` carries the proper
 * generated `Config` type and is passed through unchanged.
 */
export function resolveServerDefaults(options?: {
  hostname?: string
  port?: number
  timeout?: number
  allowNetworkBind?: boolean
  signal?: AbortSignal
  config?: Record<string, unknown>
  auth?: { username?: string; password?: string }
}) {
  const resolved = Object.assign(
    { hostname: DEFAULT_HOSTNAME, port: DEFAULT_PORT, timeout: DEFAULT_TIMEOUT },
    options ?? {},
  )
  const hostname = normalizeLoopbackHostname(resolved.hostname ?? DEFAULT_HOSTNAME)
  assertSdkHttpLoopbackBind(hostname, resolved.allowNetworkBind, "createAxCodeServer")
  return { ...resolved, hostname }
}

export function buildServerArgs(hostname: string, port: number, logLevel?: string) {
  const args = [`serve`, `--hostname=${hostname}`, `--port=${port}`]
  if (logLevel) args.push(`--log-level=${logLevel}`)
  return args
}

export function buildAuthHeaders(username: string, password: string) {
  return {
    Authorization: "Basic " + Buffer.from(`${username}:${password}`).toString("base64"),
  }
}

/**
 * Resolve a command through the same environment that will be passed to spawn.
 *
 * Bun currently resolves bare commands against the process startup PATH rather
 * than a PATH mutated later on process.env. The SDK tests and embedders rely on
 * runtime PATH overlays, so resolve the executable before spawn sees it.
 */
export function resolveSpawnCommand(command: string, env: NodeJS.ProcessEnv = process.env) {
  if (!command || command.includes("/") || command.includes("\\") || path.isAbsolute(command)) return command

  const pathValue = env.PATH ?? env.Path ?? env.path
  if (!pathValue) return command

  const extensions = executableExtensions(command, env)
  for (const entry of pathValue.split(path.delimiter)) {
    if (!entry) continue
    for (const extension of extensions) {
      const candidate = path.join(entry, command + extension)
      try {
        accessSync(candidate, constants.X_OK)
        return candidate
      } catch {}
    }
  }

  return command
}

function executableExtensions(command: string, env: NodeJS.ProcessEnv) {
  if (process.platform !== "win32") return [""]

  const pathext = env.PATHEXT ?? env.PathExt ?? ".COM;.EXE;.BAT;.CMD"
  const commandLower = command.toLowerCase()
  const extensions = ["", ...pathext.split(";").filter(Boolean)]
  return [...new Set(extensions.filter((extension) => !extension || !commandLower.endsWith(extension.toLowerCase())))]
}

/**
 * Wait for the spawned server process to print its ready line on stdout,
 * then resolve with the parsed URL. Rejects on timeout, process exit, or
 * process error.
 */
export function waitForServerReady(proc: Proc, options: { timeout: number; signal?: AbortSignal }): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      fail(new Error(`Timeout waiting for server to start after ${options.timeout}ms`))
    }, options.timeout)
    let stdoutOutput = ""
    let stderrOutput = ""
    let settled = false

    const onStdout = (chunk: any) => {
      stdoutOutput += chunk.toString()
      const lines = stdoutOutput.split("\n")
      for (const line of lines) {
        const match = line.match(READY_LINE_PATTERN)
        if (match) {
          succeed(match[1]!)
          return
        }
      }
    }
    const onStderr = (chunk: any) => {
      stderrOutput += chunk.toString()
    }
    const cleanup = () => {
      proc.stdout?.removeListener("data", onStdout)
      proc.stderr?.removeListener("data", onStderr)
      if (options.signal) options.signal.removeEventListener("abort", onAbort)
    }
    const fail = (error: Error, kill = true) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      cleanup()
      if (kill) {
        try {
          proc.kill("SIGTERM")
        } catch {}
      }
      reject(error)
    }
    const succeed = (url: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      cleanup()
      resolve(url)
    }
    const onAbort = () => {
      fail(new Error("Aborted"))
    }

    proc.stdout?.on("data", onStdout)
    proc.stderr?.on("data", onStderr)
    proc.on("exit", (code) => {
      const combined = [stdoutOutput, stderrOutput].filter(Boolean).join("\n")
      let msg = `Server exited with code ${code}`
      if (combined.trim()) {
        msg += `\nServer output: ${combined}`
      }
      fail(new Error(msg), false)
    })
    proc.on("error", (error) => {
      fail(error, false)
    })
    if (options.signal) {
      options.signal.addEventListener("abort", onAbort, { once: true })
    }
  })
}

export function assertSdkHttpLoopbackBind(hostname: string, _allowNetworkBind: boolean | undefined, helper: string) {
  if (isLoopbackHostname(hostname)) return
  throw new Error(
    `${helper} only binds the HTTP API to loopback hostnames. ` +
      `Refusing hostname ${hostname}. ` +
      "Remote AX Code access is disabled by the local-only policy.",
  )
}

export function isLoopbackHostname(hostname: string) {
  const normalized = normalizeLoopbackHostname(hostname)
  return normalized === "localhost" || normalized === "::1" || isIpv4Loopback(normalized)
}

export function normalizeLoopbackHostname(hostname: string) {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
}

export function formatHostnameForUrl(hostname: string) {
  const normalized = normalizeLoopbackHostname(hostname)
  return normalized.includes(":") ? `[${normalized}]` : normalized
}

function isIpv4Loopback(hostname: string) {
  const parts = hostname.split(".")
  if (parts.length !== 4 || parts[0] !== "127") return false
  return parts.every((part) => {
    if (!/^\d+$/.test(part)) return false
    const value = Number(part)
    return value >= 0 && value <= 255
  })
}

/**
 * Gracefully terminate a child process: send SIGTERM first, then
 * escalate to SIGKILL if the process does not exit within `graceMs`.
 * Returns a promise that resolves when the process has exited.
 */
export function closeProcGracefully(proc: Proc, graceMs = SIGTERM_KILL_GRACE_MS): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve()
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
      proc.kill("SIGTERM")
    } catch {
      finish()
      return
    }
    forceKill = setTimeout(() => {
      try {
        proc.kill("SIGKILL")
      } catch {}
    }, graceMs)
    giveUp = setTimeout(finish, SIGKILL_GIVE_UP_MS)
  })
}
