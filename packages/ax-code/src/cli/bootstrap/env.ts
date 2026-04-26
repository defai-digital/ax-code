import { Installation } from "../../installation"
import { runtimeMode } from "../../installation/runtime-mode"
import { NativePerf } from "../../perf/native"
import { Log } from "../../util/log"
import path from "path"
import os from "os"
import { DiagnosticLog } from "../../debug/diagnostic-log"

export type Opts = {
  logLevel?: string
  sandbox?: string
  debug?: boolean
  debugDir?: string
  debugIncludeContent?: boolean
}

export type InitDep = {
  argv?: string[]
  local?: boolean
  version?: string
  pid?: number
  cwd?: string
  now?: Date
  env?: Record<string, string | undefined>
  log?: (opts: Log.Options) => void | Promise<void>
  info?: (msg: string, data: Record<string, unknown>) => void
}

export function level(log?: string, _local = Installation.isLocal(), debug = false): Log.Level {
  if (debug) return "DEBUG"
  if (log) return log as Log.Level
  // Default to INFO even in local/dev mode. DEBUG output leaks into
  // the TUI in compatible mode (main-screen) and confuses users.
  // Use --print-logs or --debug to enable verbose logging explicitly.
  return "INFO"
}

export function debugOptions(opts: Pick<Opts, "debug" | "debugDir" | "debugIncludeContent">, cwd = process.cwd()) {
  const enabled = opts.debug === true
  const baseDir = enabled ? (opts.debugDir ? path.resolve(cwd, opts.debugDir) : path.join(os.tmpdir(), "ax-code-log")) : undefined
  return {
    enabled,
    baseDir,
    dir: baseDir,
    includeContent: opts.debugIncludeContent === true,
  }
}

export function debugRunDir(baseDir: string, pid = process.pid, now = new Date()) {
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "").replace("T", "-")
  return path.join(baseDir, `${stamp}-${pid}`)
}

export function apply(
  opts: Pick<Opts, "sandbox" | "debug" | "debugDir" | "debugIncludeContent">,
  env = process.env,
  pid = process.pid,
  debugDir?: string,
) {
  env.AGENT = "1"
  env.AX_CODE = "1"
  env.OPENCODE = "1"
  env.AX_CODE_PID = String(pid)
  if (opts.sandbox) env.AX_CODE_ISOLATION_MODE = opts.sandbox
  if (opts.debug) {
    env.AX_CODE_DEBUG = "1"
    env.AX_CODE_DEBUG_DIR = debugDir ?? debugOptions(opts).dir
    env.AX_CODE_DEBUG_INCLUDE_CONTENT = opts.debugIncludeContent ? "1" : "0"
  }
}

let shellEnvReady: Promise<void> | undefined

/**
 * Await this before accessing environment variables that may come from the
 * user's shell profile (e.g., API keys set in .zshrc/.bashrc). The shell env
 * is loaded in the background during init() so it doesn't block startup.
 */
export function ensureShellEnv() {
  return shellEnvReady ?? Promise.resolve()
}

async function loadShellEnv(env: Record<string, string | undefined>) {
  if (process.platform === "win32") return
  const shell = env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash")
  try {
    const proc = Bun.spawn([shell, "-l", "-c", "env -0"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
      env: { ...env, TERM: "dumb", NO_COLOR: "1" },
    })
    let timeoutId: ReturnType<typeof setTimeout>
    const timeout = new Promise<string>((_, reject) => {
      timeoutId = setTimeout(() => {
        proc.kill()
        reject(new Error("timeout"))
      }, 3000)
    })
    const stdout = await Promise.race([new Response(proc.stdout).text(), timeout]).catch(() => "")
    clearTimeout(timeoutId!)
    if (!stdout) return
    for (const entry of stdout.split("\0")) {
      const eq = entry.indexOf("=")
      if (eq <= 0) continue
      const key = entry.slice(0, eq)
      if (key in env) continue // don't overwrite existing vars
      env[key] = entry.slice(eq + 1)
    }
  } catch {
    // Shell env loading is best-effort — don't fail startup
  }
}

export async function init(opts: Opts, dep: InitDep = {}) {
  const argv = dep.argv ?? process.argv
  const local = dep.local ?? Installation.isLocal()
  const version = dep.version ?? Installation.VERSION
  const pid = dep.pid ?? process.pid
  const cwd = dep.cwd ?? process.cwd()
  const now = dep.now ?? new Date()
  const env = dep.env ?? process.env
  const log = dep.log ?? Log.init
  const info = dep.info ?? ((msg: string, data: Record<string, unknown>) => Log.Default.info(msg, data))

  // Start shell env loading in the background instead of blocking startup.
  // Shell env is only needed for provider API keys and tool execution,
  // not for CLI parsing or TUI rendering.
  shellEnvReady = loadShellEnv(env)

  const debug = debugOptions(opts, cwd)
  const debugDir = debug.enabled && debug.baseDir ? debugRunDir(debug.baseDir, pid, now) : undefined
  await DiagnosticLog.configure({
    enabled: debug.enabled,
    dir: debugDir,
    includeContent: debug.includeContent,
    manifest: {
      component: "main",
      version,
      pid,
      argv: argv.slice(2),
      cwd,
      runtimeMode: runtimeMode(),
    },
  })
  if (debug.enabled) DiagnosticLog.installProcessDiagnostics()

  await log({
    print: argv.includes("--print-logs"),
    dev: local,
    level: level(opts.logLevel, local, debug.enabled),
    ...(debugDir ? { dir: debugDir, name: "main" } : { name: Log.stampedName("main", now) }),
  })
  NativePerf.install()

  apply(opts, env, pid, debugDir)

  info("ax-code", {
    version,
    args: argv.slice(2),
  })
}
