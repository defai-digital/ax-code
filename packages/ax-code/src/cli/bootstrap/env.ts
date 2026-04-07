import { Installation } from "../../installation"
import { Log } from "../../util/log"

export type Opts = {
  logLevel?: string
  sandbox?: string
}

export type InitDep = {
  argv?: string[]
  local?: boolean
  version?: string
  pid?: number
  env?: Record<string, string | undefined>
  log?: (opts: Log.Options) => void | Promise<void>
  info?: (msg: string, data: Record<string, unknown>) => void
}

export function level(log?: string, local = Installation.isLocal()): Log.Level {
  if (log) return log as Log.Level
  if (local) return "DEBUG"
  return "INFO"
}

export function apply(opts: Pick<Opts, "sandbox">, env = process.env, pid = process.pid) {
  env.AGENT = "1"
  env.AX_CODE = "1"
  env.OPENCODE = "1"
  env.AX_CODE_PID = String(pid)
  if (opts.sandbox) env.AX_CODE_ISOLATION_MODE = opts.sandbox
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
    const timer = setTimeout(() => proc.kill(), 3000)
    const stdout = await new Response(proc.stdout).text().catch(() => "")
    clearTimeout(timer)
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
  const env = dep.env ?? process.env
  const log = dep.log ?? Log.init
  const info = dep.info ?? ((msg: string, data: Record<string, unknown>) => Log.Default.info(msg, data))

  await loadShellEnv(env)

  await log({
    print: argv.includes("--print-logs"),
    dev: local,
    level: level(opts.logLevel, local),
  })

  apply(opts, env, pid)

  info("ax-code", {
    version,
    args: argv.slice(2),
  })
}
