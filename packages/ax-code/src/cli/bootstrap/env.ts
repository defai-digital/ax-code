import { Installation } from "../../installation"
import { NativePerf } from "../../perf/native"
import { Log } from "../../util/log"

export type Opts = {
  debugger?: boolean
  logLevel?: string
  sandbox?: string
}

export type InitDep = {
  argv?: string[]
  local?: boolean
  version?: string
  pid?: number
  env?: Record<string, string | undefined>
  cwd?: string
  load?: (env: Record<string, string | undefined>) => Promise<void>
  log?: (opts: Log.Options) => void | Promise<void>
  info?: (msg: string, data: Record<string, unknown>) => void
  write?: (text: string) => void
}

export function level(log?: string, local = Installation.isLocal(), dbg = false): Log.Level {
  if (dbg) return "DEBUG"
  if (log) return log as Log.Level
  if (local) return "DEBUG"
  return "INFO"
}

export function apply(opts: Pick<Opts, "debugger" | "sandbox">, env = process.env, pid = process.pid) {
  env.AGENT = "1"
  env.AX_CODE = "1"
  env.OPENCODE = "1"
  env.AX_CODE_PID = String(pid)
  if (opts.sandbox) env.AX_CODE_ISOLATION_MODE = opts.sandbox
  if (!opts.debugger) return
  env.AX_CODE_DEBUGGER = "1"
  env.AX_CODE_DISABLE_AUTOUPDATE = "1"
}

export function banner(input: { cwd: string; log: string; pid: number; version: string }) {
  const json = input.log.endsWith(".log") ? input.log.replace(/\.log$/, ".json.log") : input.log
  return [
    "",
    "  ax-code debugger",
    "",
    `  version: ${input.version}`,
    `  pid: ${input.pid}`,
    `  cwd: ${input.cwd}`,
    `  log: ${input.log}`,
    `  json: ${json}`,
    "  trace: ax-code trace --logs",
    "  autoupdate: disabled",
    "",
  ].join("\n")
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
    let timer: ReturnType<typeof setTimeout>
    const timeout = new Promise<string>((_, reject) => {
      timer = setTimeout(() => {
        proc.kill()
        reject(new Error("timeout"))
      }, 3000)
    })
    const stdout = await Promise.race([
      new Response(proc.stdout).text(),
      timeout,
    ])
      .catch(() => "")
      .finally(() => clearTimeout(timer!))
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
  const cwd = dep.cwd ?? process.cwd()
  const local = dep.local ?? Installation.isLocal()
  const version = dep.version ?? Installation.VERSION
  const pid = dep.pid ?? process.pid
  const env = dep.env ?? process.env
  const dbg = opts.debugger === true
  const load = dep.load ?? loadShellEnv
  const log = dep.log ?? Log.init
  const info = dep.info ?? ((msg: string, data: Record<string, unknown>) => Log.Default.info(msg, data))
  const write = dep.write ?? ((text: string) => void process.stderr.write(text))

  await load(env)

  await log({
    print: argv.includes("--print-logs"),
    dev: local,
    level: level(opts.logLevel, local, dbg),
  })
  NativePerf.install()

  apply(opts, env, pid)

  info("ax-code", {
    version,
    args: argv.slice(2),
    debugger: dbg ? true : undefined,
  })

  if (!dbg) return
  const file = Log.file() || "stderr (--print-logs)"
  write(banner({ cwd, log: file, pid, version }))
  info("debugger", {
    cwd,
    log: file,
    pid,
    trace: "ax-code trace --logs",
  })
}
