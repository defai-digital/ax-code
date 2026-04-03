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

export async function init(opts: Opts, dep: InitDep = {}) {
  const argv = dep.argv ?? process.argv
  const local = dep.local ?? Installation.isLocal()
  const version = dep.version ?? Installation.VERSION
  const pid = dep.pid ?? process.pid
  const env = dep.env ?? process.env
  const log = dep.log ?? Log.init
  const info = dep.info ?? ((msg: string, data: Record<string, unknown>) => Log.Default.info(msg, data))

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
