// Process helpers for the perf harness: cross-platform peak-RSS polling,
// SIGTERM-then-SIGKILL teardown, stderr capture, and error formatting. The
// teardown implementation is also what the harness host exposes as
// `killTree`, so LSPClient.shutdown() exercises the same escalation path the
// production host uses.
import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { promisify } from "node:util"
import { inspect } from "node:util"
import type { KillableProcess } from "../../src/host"

const execFileAsync = promisify(execFile)

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// Ring buffer over a child process's stderr. LSP servers report startup
// failures on stderr and then die; without capturing it, a failed spawn
// surfaces as a bare "initialize error" with no hint of the cause.
export function captureStderr(process: { stderr?: NodeJS.ReadableStream | null }, limit = 4096): { tail(): string } {
  let buffer = ""
  process.stderr?.on("data", (chunk) => {
    buffer = (buffer + String(chunk)).slice(-limit)
  })
  return {
    tail() {
      return buffer.trim()
    },
  }
}

// Render an unknown error with its full cause chain. NamedError instances
// (e.g. LSPInitializeError) carry the interesting payload in `cause`, and
// JSON-serializing them loses it — a bare `{}` in a log line helps nobody.
export function formatError(err: unknown): string {
  if (!(err instanceof Error)) return inspect(err, { depth: 4 })
  const parts = [`${err.name}: ${err.message}`.trim()]
  let cause: unknown = (err as { cause?: unknown }).cause
  while (cause !== undefined) {
    if (cause instanceof Error) {
      parts.push(`caused by ${cause.name}: ${cause.message}`.trim())
      const data = (cause as { data?: unknown }).data
      if (data !== undefined) parts.push(`  data: ${inspect(data, { depth: 4 })}`)
      cause = (cause as { cause?: unknown }).cause
    } else {
      parts.push(`caused by ${inspect(cause, { depth: 4 })}`)
      cause = undefined
    }
  }
  return parts.join("\n")
}

// Race a promise against a ref'd deadline. The package's internal
// withTimeout is unref'd — correct for a long-running process, but in a
// one-shot harness a server that dies without answering initialize leaves no
// event-loop handles behind, and an unref'd timer would let Node exit with
// an unsettled-await warning instead of a useful error. This timer stays
// ref'd so the harness always fails (or finishes) deliberately.
export function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let settled = false
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`${label} timed out after ${ms}ms`))
    }, ms)
    promise.then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

// Resident set size in KB. Linux reads /proc directly; everything else
// (macOS included) falls back to `ps -o rss=`. Returns undefined once the
// process is gone instead of throwing.
export async function readRssKb(pid: number): Promise<number | undefined> {
  if (process.platform === "linux") {
    try {
      const status = await readFile(`/proc/${pid}/status`, "utf8")
      const match = /^VmRSS:\s+(\d+)\s+kB/m.exec(status)
      return match ? Number(match[1]) : undefined
    } catch {
      return undefined
    }
  }
  try {
    const { stdout } = await execFileAsync("ps", ["-o", "rss=", "-p", String(pid)])
    const kb = Number(stdout.trim())
    return Number.isFinite(kb) && kb > 0 ? kb : undefined
  } catch {
    return undefined
  }
}

export type RssPoller = {
  stop(): Promise<number | undefined>
}

// Poll a pid at a fixed interval and keep the maximum observed RSS. The
// caller stops the poller at the end of the measured section; stop() takes
// one final sample so a short run still records something.
export function pollPeakRss(pid: number | undefined, intervalMs = 100): RssPoller {
  let peak: number | undefined
  let stopped = false
  const sample = async () => {
    if (pid === undefined) return
    const kb = await readRssKb(pid)
    if (kb !== undefined) peak = Math.max(peak ?? 0, kb)
  }
  void sample()
  const timer = setInterval(() => void sample(), intervalMs)
  timer.unref?.()
  return {
    async stop() {
      if (stopped) return peak
      stopped = true
      clearInterval(timer)
      await sample()
      return peak
    },
  }
}

// Graceful SIGTERM with SIGKILL escalation after a 2s grace period. Mirrors
// the teardown contract the harness documents for spawned LSP servers.
export async function killTree(
  proc: KillableProcess,
  opts?: { exited?: () => boolean; signal?: NodeJS.Signals | number },
): Promise<void> {
  const exited = opts?.exited ?? (() => false)
  if (exited()) return
  try {
    proc.kill(opts?.signal ?? "SIGTERM")
  } catch {
    // Already gone.
  }
  const deadline = Date.now() + 2_000
  while (!exited() && Date.now() < deadline) {
    await sleep(50)
  }
  if (exited()) return
  try {
    proc.kill("SIGKILL")
  } catch {
    // Already gone.
  }
  const killDeadline = Date.now() + 1_000
  while (!exited() && Date.now() < killDeadline) {
    await sleep(50)
  }
}
