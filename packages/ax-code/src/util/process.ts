import { type ChildProcess } from "child_process"
import launch from "cross-spawn"
import { buffer } from "node:stream/consumers"

export namespace Process {
  export type Stdio = "inherit" | "pipe" | "ignore"
  export type Shell = boolean | string
  export type WebStream = ReadableStream<Uint8Array> | null | undefined

  export interface Options {
    cwd?: string
    env?: NodeJS.ProcessEnv | null
    stdin?: Stdio
    stdout?: Stdio
    stderr?: Stdio
    shell?: Shell
    abort?: AbortSignal
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

  export interface CaptureOptions {
    timeout?: number
    kill?: NodeJS.Signals | number
  }

  export interface CaptureResult {
    code: number
    stdout: string
    stderr: string
    timedOut: boolean
  }

  export interface CaptureProc {
    stdout: WebStream
    stderr: WebStream
    exited: Promise<number>
    kill(signal?: NodeJS.Signals | number): void
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

  export async function readText(
    stream: WebStream,
    opts: {
      timeout?: number
      onTimeout?: () => void
    } = {},
  ) {
    if (!stream) return ""

    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let timedOut = false
    const id =
      typeof opts.timeout === "number" && opts.timeout > 0
        ? setTimeout(() => {
            timedOut = true
            opts.onTimeout?.()
            void reader.cancel().catch(() => undefined)
          }, opts.timeout)
        : undefined

    try {
      let text = ""
      while (true) {
        const part = await reader.read().catch((err) => {
          if (timedOut) return { done: true as const, value: undefined }
          throw err
        })
        if (part.done) break
        text += decoder.decode(part.value, { stream: true })
      }
      return text + decoder.decode()
    } finally {
      if (id) clearTimeout(id)
    }
  }

  export async function capture(proc: CaptureProc, opts: CaptureOptions = {}): Promise<CaptureResult> {
    let done = false
    let timedOut = false
    let killId: ReturnType<typeof setTimeout> | undefined
    let exitId: ReturnType<typeof setTimeout> | undefined

    const stop = () => {
      if (done) return
      timedOut = true
      try {
        proc.kill(opts.kill ?? "SIGTERM")
      } catch {}
      if (killId) return
      killId = setTimeout(() => {
        try {
          proc.kill("SIGKILL")
        } catch {}
      }, 250)
    }

    const exit = new Promise<number>((resolve, reject) => {
      proc.exited.then(
        (code) => {
          done = true
          resolve(code)
        },
        (err) => {
          done = true
          reject(err)
        },
      )

      if (typeof opts.timeout === "number" && opts.timeout > 0) {
        exitId = setTimeout(() => {
          stop()
          done = true
          resolve(1)
        }, opts.timeout)
      }
    })

    try {
      const [code, stdout, stderr] = await Promise.all([
        exit,
        readText(proc.stdout, { timeout: opts.timeout, onTimeout: stop }),
        readText(proc.stderr, { timeout: opts.timeout, onTimeout: stop }),
      ])
      return {
        code,
        stdout,
        stderr,
        timedOut,
      }
    } finally {
      if (exitId) clearTimeout(exitId)
      if (killId) clearTimeout(killId)
    }
  }

  export function spawn(cmd: string[], opts: Options = {}): Child {
    if (cmd.length === 0) throw new Error("Command is required")
    opts.abort?.throwIfAborted()

    const proc = launch(cmd[0], cmd.slice(1), {
      cwd: opts.cwd,
      shell: opts.shell,
      env: opts.env === null ? {} : opts.env ?? undefined,
      stdio: [opts.stdin ?? "ignore", opts.stdout ?? "ignore", opts.stderr ?? "ignore"],
      windowsHide: process.platform === "win32",
    })

    let closed = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const abort = () => {
      if (closed) return
      if (proc.exitCode !== null || proc.signalCode !== null) return
      closed = true

      proc.kill(opts.kill ?? "SIGTERM")

      const ms = opts.timeout ?? 5_000
      if (ms <= 0) return
      timer = setTimeout(() => proc.kill("SIGKILL"), ms)
    }

    const exited = new Promise<number>((resolve, reject) => {
      const done = () => {
        opts.abort?.removeEventListener("abort", abort)
        if (timer) clearTimeout(timer)
      }

      proc.once("exit", (code, signal) => {
        done()
        resolve(code ?? (signal ? 1 : 0))
      })

      proc.once("error", (error) => {
        done()
        reject(error)
      })
    })
    void exited.catch(() => undefined)

    if (opts.abort) {
      opts.abort.addEventListener("abort", abort, { once: true })
      if (opts.abort.aborted) abort()
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
          stderr: Buffer.from(err instanceof Error ? err.message : String(err)),
        }
      })
    if (out.code === 0 || opts.nothrow) return out
    throw new RunFailedError(cmd, out.code, out.stdout, out.stderr)
  }

  export async function stop(proc: ChildProcess) {
    if (process.platform !== "win32" || !proc.pid) {
      proc.kill()
      return
    }

    const out = await run(["taskkill", "/pid", String(proc.pid), "/T", "/F"], {
      nothrow: true,
    })

    if (out.code === 0) return
    proc.kill()
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
