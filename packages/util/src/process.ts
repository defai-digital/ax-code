import { type ChildProcess } from "child_process"
import { type Readable } from "node:stream"
import launch from "cross-spawn"
import { toErrorMessage } from "./error-message"

// Spawn/kill helpers shared by @ax-code/ax-code-intel and @ax-code/ax-code-reason.
//
// Both packages used to carry byte-identical copies of this file and differed
// only in which host owns process-tree termination, so the tree killer is
// injected through `createProcess` and each package binds its own host — the
// same shape as `leveled-log`'s per-package runtime.
//
// Core keeps its own implementation (ax-code/src/util/process.ts): it adds
// `unref`/`detached` support and a bounded drain grace that these callers do
// not use. Do not merge the two without revisiting those differences.

// Drain a child stream tolerantly. The strict `node:stream/consumers` buffer()
// rejects with ERR_STREAM_PREMATURE_CLOSE when the stream is destroy()ed (which
// `spawn` does on exit to unblock pipes held open by background children) before
// it reaches a natural EOF — a race that surfaces under concurrent spawns. Node
// still emits all buffered `data` events before `close`, so collecting via raw
// events and resolving on end/close/error returns the full output without the
// spurious rejection.
function drain(stream: Readable): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    const finish = () => resolve(Buffer.concat(chunks))
    stream.once("end", finish)
    stream.once("close", finish)
    stream.once("error", finish)
  })
}

const TIMEOUT_FORCE_KILL_GRACE_MS = 250

export type ProcessStdio = "inherit" | "pipe" | "ignore" | number
export type ProcessShell = boolean | string

export interface ProcessOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv | null
  stdin?: ProcessStdio
  stdout?: ProcessStdio
  stderr?: ProcessStdio
  shell?: ProcessShell
  abort?: AbortSignal
  detached?: boolean
  kill?: NodeJS.Signals | number
  timeout?: number
}

export interface ProcessRunOptions extends Omit<ProcessOptions, "stdout" | "stderr"> {
  nothrow?: boolean
}

export interface ProcessResult {
  code: number
  stdout: Buffer
  stderr: Buffer
}

export interface ProcessTextResult extends ProcessResult {
  text: string
}

export class ProcessRunFailedError extends Error {
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

export type ProcessChild = ChildProcess & { exited: Promise<number> }

export type ProcessKillable = {
  pid?: number
  kill: (signal?: NodeJS.Signals | number) => boolean | void
  exitCode?: number | null
  signalCode?: NodeJS.Signals | number | null
}

/** Tree termination supplied by the host that owns the spawned processes. */
export type ProcessKillTree = (
  proc: { pid?: number; kill: (signal?: NodeJS.Signals | number) => boolean | void },
  options?: { exited?: () => boolean; signal?: NodeJS.Signals | number },
) => Promise<void>

export type ProcessApi = {
  spawn(cmd: string[], opts?: ProcessOptions): ProcessChild
  run(cmd: string[], opts?: ProcessRunOptions): Promise<ProcessResult>
  text(cmd: string[], opts?: ProcessRunOptions): Promise<ProcessTextResult>
  lines(cmd: string[], opts?: ProcessRunOptions): Promise<string[]>
  stop(proc: ChildProcess): Promise<void>
  killProcessTree(proc: ProcessKillable, options?: { signal?: NodeJS.Signals | number }): Promise<void>
  /**
   * argv for running a shell command string. Stock Windows has no `sh`, so
   * use `cmd /c` there and `sh -c` everywhere else.
   */
  shellCommand(command: string, platform?: NodeJS.Platform): string[]
  RunFailedError: typeof ProcessRunFailedError
}

export function createProcess(killTree: ProcessKillTree): ProcessApi {
  async function killProcessTree(proc: ProcessKillable, options?: { signal?: NodeJS.Signals | number }): Promise<void> {
    if (!proc.pid) return
    const signal = options?.signal
    const exited = () =>
      (proc.exitCode !== undefined && proc.exitCode !== null) ||
      (proc.signalCode !== undefined && proc.signalCode !== null)
    await killTree(
      {
        pid: proc.pid,
        kill: (killSignal?: NodeJS.Signals | number) => {
          return proc.kill(killSignal)
        },
      },
      { exited, signal },
    )
  }

  function shellCommand(command: string, platform: NodeJS.Platform = process.platform): string[] {
    return platform === "win32" ? ["cmd", "/c", command] : ["sh", "-c", command]
  }

  function spawn(cmd: string[], opts: ProcessOptions = {}): ProcessChild {
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
        resolve(timedOut ? 124 : (code ?? (signal ? 1 : 0)))
        // Background children spawned by the command inherit the pipe FDs and
        // keep them open, preventing stream EOF. Destroy after one I/O cycle
        // (giving Node.js a chance to drain the kernel buffer first) so that
        // any awaiter of the piped streams unblocks regardless.
        setImmediate(() => {
          if (opts.stdout === "pipe") (proc as ChildProcess).stdout?.destroy()
          if (opts.stderr === "pipe") (proc as ChildProcess).stderr?.destroy()
        })
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

    const child = proc as ProcessChild
    child.exited = exited
    return child
  }

  async function run(cmd: string[], opts: ProcessRunOptions = {}): Promise<ProcessResult> {
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

    const out = await Promise.all([proc.exited, drain(proc.stdout), drain(proc.stderr)])
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
    throw new ProcessRunFailedError(cmd, out.code, out.stdout, out.stderr)
  }

  async function stop(proc: ChildProcess) {
    await killProcessTree(proc)
  }

  async function text(cmd: string[], opts: ProcessRunOptions = {}): Promise<ProcessTextResult> {
    const out = await run(cmd, opts)
    return {
      ...out,
      text: out.stdout.toString(),
    }
  }

  async function lines(cmd: string[], opts: ProcessRunOptions = {}): Promise<string[]> {
    return (await text(cmd, opts)).text.split(/\r?\n/).filter(Boolean)
  }

  return { spawn, run, text, lines, stop, killProcessTree, shellCommand, RunFailedError: ProcessRunFailedError }
}
