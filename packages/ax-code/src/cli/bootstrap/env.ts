import { Installation } from "../../installation"
import { runtimeMode } from "../../installation/runtime-mode"
import { NativePerf } from "../../perf/native"
import { Log } from "../../util/log"
import path from "path"
import os from "os"
import fs from "fs/promises"
import { DiagnosticLog } from "../../debug/diagnostic-log"
import { startShellEnvLoad } from "../../runtime/shell-env"
import { cliBooleanFlagValue } from "../boolean-flag"

export { ensureShellEnv } from "../../runtime/shell-env"

export type Opts = {
  logLevel?: string
  printLogs?: boolean
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
  mkdtemp?: typeof fs.mkdtemp
}

export type RestoreOriginalCwdDep = {
  env?: Record<string, string | undefined>
  cwd?: () => string
  chdir?: (dir: string) => void
}

export type RuntimeFlagOptions = {
  pid?: number
  preservePid?: boolean
}

function setEnvValue(
  env: Record<string, string | undefined>,
  key: string,
  value: string | number | boolean | undefined,
) {
  env[key] = typeof value === "undefined" ? undefined : String(value)
}

export function seedRuntimeFlags(env: Record<string, string | undefined>, options: RuntimeFlagOptions = {}) {
  const pid = options.pid ?? process.pid
  setEnvValue(env, "AGENT", "1")
  setEnvValue(env, "AX_CODE", "1")
  setEnvValue(env, "OPENCODE", "1")
  if (options.preservePid) env.AX_CODE_PID ??= String(pid)
  else setEnvValue(env, "AX_CODE_PID", pid)
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
  const baseDir = enabled
    ? opts.debugDir
      ? path.resolve(cwd, opts.debugDir)
      : path.join(os.tmpdir(), "ax-code-log")
    : undefined
  return {
    enabled,
    baseDir,
    dir: baseDir,
    includeContent: opts.debugIncludeContent === true,
  }
}

export function debugRunDir(baseDir: string, pid = process.pid, now = new Date()) {
  const stamp = now
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "")
    .replace("T", "-")
  return path.join(baseDir, `${stamp}-${pid}`)
}

export function restoreOriginalCwd(dep: RestoreOriginalCwdDep = {}) {
  const env = dep.env ?? process.env
  const cwd = dep.cwd ?? (() => process.cwd())
  const chdir = dep.chdir ?? ((dir: string) => process.chdir(dir))
  const current = cwd()
  const original = env.AX_CODE_ORIGINAL_CWD
  if (!original) return current
  if (path.resolve(current) === path.resolve(original)) return current

  try {
    chdir(original)
    return cwd()
  } catch {
    return current
  }
}

export function apply(
  opts: Pick<Opts, "sandbox" | "debug" | "debugDir" | "debugIncludeContent">,
  env = process.env,
  pid = process.pid,
  debugDir?: string,
) {
  seedRuntimeFlags(env, { pid })
  if (opts.sandbox) {
    setEnvValue(env, "AX_CODE_ISOLATION_MODE", opts.sandbox)
    setEnvValue(env, "AX_CODE_ISOLATION_NETWORK", opts.sandbox === "full-access")
  }
  if (opts.debug) {
    setEnvValue(env, "AX_CODE_DEBUG", "1")
    setEnvValue(env, "AX_CODE_DEBUG_DIR", debugDir ?? debugOptions(opts).dir)
    setEnvValue(env, "AX_CODE_DEBUG_INCLUDE_CONTENT", opts.debugIncludeContent ? "1" : "0")
  }
}

export async function init(opts: Opts, dep: InitDep = {}) {
  const argv = dep.argv ?? process.argv
  const local = dep.local ?? Installation.isLocal()
  const version = dep.version ?? Installation.VERSION
  const pid = dep.pid ?? process.pid
  const env = dep.env ?? process.env
  const cwd = dep.cwd ?? restoreOriginalCwd({ env })
  const now = dep.now ?? new Date()
  const log = dep.log ?? Log.init
  const info = dep.info ?? ((msg: string, data: Record<string, unknown>) => Log.Default.info(msg, data))
  const mkdtemp = dep.mkdtemp ?? fs.mkdtemp

  const debug = debugOptions(opts, cwd)
  const debugBaseDir =
    debug.enabled && debug.baseDir && !opts.debugDir ? await mkdtemp(`${debug.baseDir}-`) : debug.baseDir
  const debugDir = debug.enabled && debugBaseDir ? debugRunDir(debugBaseDir, pid, now) : undefined
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
    print: opts.printLogs ?? cliBooleanFlagValue(argv, "--print-logs") === true,
    dev: local,
    level: level(opts.logLevel, local, debug.enabled),
    ...(debugDir ? { dir: debugDir, name: "main" } : { name: Log.stampedName("main", now) }),
  })
  NativePerf.install()

  apply(opts, env, pid, debugDir)

  // Start shell env loading in the background after logging is configured so
  // best-effort failures can still be diagnosed without blocking startup.
  // Shell env is only needed for provider API keys and tool execution,
  // not for CLI parsing or TUI rendering.
  startShellEnvLoad(env)

  info("ax-code", {
    version,
    args: argv.slice(2),
  })
}
