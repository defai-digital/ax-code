import type { ChildProcess } from "child_process"
import { StringDecoder } from "string_decoder"
import { Log } from "../util/log"
import { Shell } from "@/shell/shell"
import { Bus } from "@/bus"
import { NotificationEvent } from "@/notification/events"
import { TOAST_DURATION_LONG_MS } from "@/constants/server"

const log = Log.create({ service: "bash-background" })

/**
 * Registry of shells started with `bash` + `run_in_background`. Shells
 * outlive the tool call (and the turn) but not the process: every PID is
 * also in bash-impl's trackedPIDs set, so process exit still reaps them.
 * Output accumulates here and is consumed incrementally by `bash_output`;
 * `kill_shell` terminates the process group.
 */
export namespace BackgroundShell {
  export type Status = "running" | "completed" | "failed" | "killed"

  // Per-shell unread output cap (in string length units). Once the unread
  // portion exceeds this, the oldest unread output is dropped (with a
  // marker) — background commands can stream logs indefinitely and must
  // not grow RSS unbounded.
  const MAX_UNREAD_BYTES = 2 * 1024 * 1024
  const MAX_SHELLS_PER_SESSION = 16
  // Finished shells whose output was never read are retained so the model
  // can still fetch their result, but only this many per session — beyond
  // that the oldest are evicted so an unread pile-up cannot leak memory.
  const MAX_FINISHED_PER_SESSION = 16

  export interface Info {
    id: string
    sessionID: string
    command: string
    description: string
    status: Status
    exitCode: number | null
    startedAt: number
    endedAt: number | null
  }

  interface Entry extends Info {
    proc: ChildProcess
    buffer: string
    /** Byte length already returned through read(); offset into `buffer`. */
    readOffset: number
    dropped: boolean
    exited: boolean
    killRequested: boolean
    onExited?: () => void
  }

  const shells = new Map<string, Entry>()
  let counter = 0

  export function assertCapacity(sessionID: string) {
    const active = list(sessionID).filter((s) => s.status === "running")
    if (active.length >= MAX_SHELLS_PER_SESSION) {
      throw new Error(
        `Too many running background shells (${active.length}). ` +
          `Use kill_shell to terminate ones you no longer need, or wait for them to finish.`,
      )
    }
  }

  function evictFinished(sessionID: string) {
    const finished = [...shells.values()]
      .filter((s) => s.sessionID === sessionID && s.status !== "running")
      .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0))
    while (finished.length > MAX_FINISHED_PER_SESSION) {
      const oldest = finished.shift()!
      shells.delete(oldest.id)
      log.info("evicted unread finished background shell", { id: oldest.id, sessionID })
    }
  }

  export function register(input: {
    sessionID: string
    command: string
    description: string
    proc: ChildProcess
    onExited?: () => void
  }): Info {
    assertCapacity(input.sessionID)
    evictFinished(input.sessionID)
    counter += 1
    const id = `bash_${counter}`
    const entry: Entry = {
      id,
      sessionID: input.sessionID,
      command: input.command,
      description: input.description,
      status: "running",
      exitCode: null,
      startedAt: Date.now(),
      endedAt: null,
      proc: input.proc,
      buffer: "",
      readOffset: 0,
      dropped: false,
      exited: false,
      killRequested: false,
      onExited: input.onExited,
    }
    shells.set(id, entry)

    const appendText = (text: string) => {
      if (!text) return
      entry.buffer += text
      // Discard output the model has already consumed, then clamp the
      // unread remainder so a chatty process cannot grow memory forever.
      if (entry.readOffset > 0 && entry.buffer.length > MAX_UNREAD_BYTES) {
        entry.buffer = entry.buffer.slice(entry.readOffset)
        entry.readOffset = 0
      }
      if (entry.buffer.length - entry.readOffset > MAX_UNREAD_BYTES) {
        entry.buffer = entry.buffer.slice(entry.buffer.length - MAX_UNREAD_BYTES)
        entry.readOffset = 0
        entry.dropped = true
      }
    }
    // Per-stream decoders: a 'data' chunk can split a multi-byte UTF-8
    // character, and Buffer#toString would emit replacement characters at
    // the boundary. StringDecoder buffers the partial sequence instead.
    const stdoutDecoder = new StringDecoder("utf8")
    const stderrDecoder = new StringDecoder("utf8")
    input.proc.stdout?.on("data", (chunk: Buffer) => appendText(stdoutDecoder.write(chunk)))
    input.proc.stderr?.on("data", (chunk: Buffer) => appendText(stderrDecoder.write(chunk)))

    input.proc.once("exit", () => {
      entry.exited = true
      // Grandchildren spawned by the command inherit the pipe FDs and can
      // hold 'close' open indefinitely; destroy after one I/O cycle so the
      // streams drain, mirroring the foreground bash path.
      setImmediate(() => {
        input.proc.stdout?.destroy()
        input.proc.stderr?.destroy()
      })
    })

    input.proc.once("close", () => {
      appendText(stdoutDecoder.end())
      appendText(stderrDecoder.end())
      const status = entry.killRequested ? "killed" : input.proc.exitCode === 0 ? "completed" : "failed"
      finish(entry, status, input.proc.exitCode)
      // Best-effort UX: the close event can fire outside the Instance async
      // context (where Bus state is unavailable), and a throw here would be
      // an uncaught exception inside an EventEmitter handler.
      try {
        Bus.publishDetached(NotificationEvent.ToastShow, {
          title: `Background command ${entry.status}`,
          message: `${entry.description} (shell ${id}, exit ${entry.exitCode ?? "?"})`,
          variant: entry.status === "completed" ? "info" : "warning",
          duration: TOAST_DURATION_LONG_MS,
        })
      } catch (error) {
        log.warn("background shell toast publish failed", { id, error: error instanceof Error ? error.message : error })
      }
    })

    input.proc.once("error", (error) => {
      entry.buffer += `\n[background shell error] ${error instanceof Error ? error.message : String(error)}`
      finish(entry, "failed", input.proc.exitCode)
    })

    log.info("background shell started", { id, pid: input.proc.pid, sessionID: input.sessionID })
    return toInfo(entry)
  }

  function finish(entry: Entry, status: Status, exitCode: number | null) {
    if (entry.status !== "running") return
    entry.exited = true
    entry.status = status
    entry.exitCode = exitCode
    entry.endedAt = Date.now()
    entry.onExited?.()
    log.info("background shell finished", { id: entry.id, status, exitCode })
  }

  function toInfo(entry: Entry): Info {
    return {
      id: entry.id,
      sessionID: entry.sessionID,
      command: entry.command,
      description: entry.description,
      status: entry.status,
      exitCode: entry.exitCode,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
    }
  }

  export function get(id: string, sessionID?: string): Info | undefined {
    const entry = shells.get(id)
    if (!entry) return undefined
    if (sessionID !== undefined && entry.sessionID !== sessionID) return undefined
    return toInfo(entry)
  }

  export function list(sessionID?: string): Info[] {
    return [...shells.values()].filter((s) => sessionID === undefined || s.sessionID === sessionID).map(toInfo)
  }

  /** Return output produced since the previous read() for this shell. */
  export function read(id: string, sessionID?: string): { info: Info; output: string; dropped: boolean } | undefined {
    const entry = shells.get(id)
    if (!entry) return undefined
    if (sessionID !== undefined && entry.sessionID !== sessionID) return undefined
    const output = entry.buffer.slice(entry.readOffset)
    const dropped = entry.dropped
    entry.readOffset = entry.buffer.length
    entry.dropped = false
    // A finished shell whose output has been fully consumed can be
    // forgotten — nothing else will ever be written to it.
    if (entry.status !== "running") shells.delete(id)
    return { info: toInfo(entry), output, dropped }
  }

  export async function kill(id: string, sessionID?: string): Promise<Info | undefined> {
    const entry = shells.get(id)
    if (!entry) return undefined
    if (sessionID !== undefined && entry.sessionID !== sessionID) return undefined
    if (entry.status === "running") {
      entry.killRequested = true
      await Shell.killTree(entry.proc, { exited: () => entry.exited })
      finish(entry, "killed", entry.proc.exitCode)
    }
    return toInfo(entry)
  }

  /** Kill and forget every shell belonging to a session (used on session removal). */
  export async function killForSession(sessionID: string): Promise<void> {
    for (const entry of [...shells.values()]) {
      if (entry.sessionID !== sessionID) continue
      if (entry.status === "running") {
        entry.killRequested = true
        await Shell.killTree(entry.proc, { exited: () => entry.exited }).catch(() => undefined)
        finish(entry, "killed", entry.proc.exitCode)
      }
      shells.delete(entry.id)
    }
  }

  /** Test-only: forget all shells without killing anything. */
  export function resetForTests() {
    shells.clear()
    counter = 0
  }
}
