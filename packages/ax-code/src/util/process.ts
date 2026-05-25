import { type ChildProcess } from "child_process"
import launch from "cross-spawn"
import { buffer } from "node:stream/consumers"
import { Shell } from "../shell/shell"
import { toErrorMessage } from "./error-message"

const TIMEOUT_FORCE_KILL_GRACE_MS = 250

export namespace Process {
  export type Stdio = "inherit" | "pipe" | "ignore"
  export type Shell = boolean | string

  export interface Options {
    cwd?: string
    env?: NodeJS.ProcessEnv | null
    stdin?: Stdio
    stdout?: Stdio
    stderr?: Stdio
    shell?: Shell
    abort?: AbortSignal
    detached?: boolean
    kill?: NodeJS.Signals | number
    timeout?: number
  }

  export interface RunOptions extends Omit<Options, "stdout" | "stderr"> {
    nothrow?: boolean
  }

  export interface Result {
    code: number
    stdout: Buffer
    stderr: Buffer
  }

  export interface TextResult extends Result {
    text: string
  }

  export class RunFailedError extends Error {
    readonly cmd: string[]
    readonly code: number
    readonly stdout: Buffer
    readonly stderr: Buffer

    constructor(cmd: string[], code: number, stdout: Buffer, stderr: Buffer) {
      const text = stderr.toString().trim()
      super(
        text
          ? `Command failed with code ${code}: ${cmd.join(" ")}\n${text}`
          : `Command failed with code ${code}: ${cmd.join(" ")}`,
      )
      this.name = "ProcessRunFailedError"
      this.cmd = [...cmd]
      this.code = code
      this.stdout = stdout
      this.stderr = stderr
    }
  }

  export type Child = ChildProcess & { exited: Promise<number> }

  type KillableProcess = {
    pid?: number
    kill: (signal?: NodeJS.Signals | number) => boolean | void
    exitCode?: number | null
    signalCode?: NodeJS.Signals | number | null
  }

  export async function killProcessTree(
    proc: KillableProcess,
    options?: { signal?: NodeJS.Signals | number },
  ): Promise<void> {
    if (!proc.pid) return
    const signal = options?.signal
    const exited = () =>
      (proc.exitCode !== undefined && proc.exitCode !== null) ||
      (proc.signalCode !== undefined && proc.signalCode !== null)
    await Shell.killTree(
      {
        pid: proc.pid,
        kill: (killSignal?: NodeJS.Signals | number) => {
          return proc.kill(killSignal)
        },
      },
      { exited, signal },
    )
  }

  export function spawn(cmd: string[], opts: Options = {}): Child {
    if (cmd.length === 0) throw new Error("Command is required")
    opts.abort?.throwIfAborted()

    const proc = launch(cmd[0], cmd.slice(1), {
      cwd: opts.cwd,
      shell: opts.shell,
      env: opts.env === null ? {} : (opts.env ?? undefined),
      detached: opts.detached,
      stdio: [opts.stdin ?? "ignore", opts.stdout ?? "ignore", opts.stderr ?? "ignore"],
      windowsHide: process.platform === "win32",
    })

    let closed = false
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined
    let timedOut = false

    const terminate = (graceful = true) => {
      if (closed) return
      if (proc.exitCode !== null || proc.signalCode !== null) return
      closed = true
      if (timeoutTimer) clearTimeout(timeoutTimer)
      if (!graceful) timedOut = true
      // Abort and timeout semantics diverge:
      // - graceful (abort): prefer full-tree termination so we don't leave subprocesses behind,
      //   with a short hard-kill fallback handled inside killProcessTree.
      // - non-graceful (timeout): keep existing timed escalation behavior.
      if (graceful) {
        void killProcessTree(proc, { signal: opts.kill }).catch(() => undefined)
        return
      }

      const signal = opts.kill ?? "SIGTERM"
      proc.kill(signal)
      if (TIMEOUT_FORCE_KILL_GRACE_MS <= 0) return
      forceKillTimer = setTimeout(() => {
        void killProcessTree(proc, { signal: opts.kill }).catch(() => undefined)
      }, TIMEOUT_FORCE_KILL_GRACE_MS)
    }

    const exited = new Promise<number>((resolve, reject) => {
      const done = () => {
        if (opts.abort && onAbort) {
          opts.abort.removeEventListener("abort", onAbort)
        }
        if (forceKillTimer) clearTimeout(forceKillTimer)
        if (timeoutTimer) clearTimeout(timeoutTimer)
      }

      proc.once("exit", (code, signal) => {
        done()
        resolve(timedOut ? 124 : code ?? (signal ? 1 : 0))
      })

      proc.once("error", (error) => {
        done()
        reject(error)
      })
    })
    void exited.catch(() => undefined)

    const onAbort = () => terminate(true)
    if (opts.abort) {
      opts.abort.addEventListener("abort", onAbort, { once: true })
      if (opts.abort.aborted) terminate(true)
    }

    if (opts.timeout !== undefined) {
      timeoutTimer = setTimeout(() => terminate(false), opts.timeout)
    }

    const child = proc as Child
    child.exited = exited
    return child
  }

  export async function run(cmd: string[], opts: RunOptions = {}): Promise<Result> {
    const proc = spawn(cmd, {
      cwd: opts.cwd,
      env: opts.env,
      stdin: opts.stdin,
      shell: opts.shell,
      abort: opts.abort,
      kill: opts.kill,
      timeout: opts.timeout,
      stdout: "pipe",
      stderr: "pipe",
    })

    if (!proc.stdout || !proc.stderr) throw new Error("Process output not available")

    const out = await Promise.all([proc.exited, buffer(proc.stdout), buffer(proc.stderr)])
      .then(([code, stdout, stderr]) => ({
        code,
        stdout,
        stderr,
      }))
      .catch((err: unknown) => {
        if (!opts.nothrow) throw err
        return {
          code: 1,
          stdout: Buffer.alloc(0),
          stderr: Buffer.from(toErrorMessage(err)),
        }
      })
    if (out.code === 0 || opts.nothrow) return out
    throw new RunFailedError(cmd, out.code, out.stdout, out.stderr)
  }

  export async function stop(proc: ChildProcess) {
    await killProcessTree(proc)
  }

  export async function text(cmd: string[], opts: RunOptions = {}): Promise<TextResult> {
    const out = await run(cmd, opts)
    return {
      ...out,
      text: out.stdout.toString(),
    }
  }

  export async function lines(cmd: string[], opts: RunOptions = {}): Promise<string[]> {
    return (await text(cmd, opts)).text.split(/\r?\n/).filter(Boolean)
  }
}
