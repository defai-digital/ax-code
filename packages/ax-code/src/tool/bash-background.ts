import type { ChildProcess } from "child_process"
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

  // Per-shell unread output cap. Once the unread portion exceeds this,
  // the oldest unread bytes are dropped (with a marker) — background
  // commands can stream logs indefinitely and must not grow RSS unbounded.
  const MAX_UNREAD_BYTES = 2 * 1024 * 1024
  const MAX_SHELLS_PER_SESSION = 16

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

  export function register(input: {
    sessionID: string
    command: string
    description: string
    proc: ChildProcess
    onExited?: () => void
  }): Info {
    assertCapacity(input.sessionID)
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

    const append = (chunk: Buffer) => {
      entry.buffer += chunk.toString()
      // Discard bytes the model has already consumed, then clamp the
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
    input.proc.stdout?.on("data", append)
    input.proc.stderr?.on("data", append)

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
      const status = entry.killRequested ? "killed" : input.proc.exitCode === 0 ? "completed" : "failed"
      finish(entry, status, input.proc.exitCode)
      Bus.publishDetached(NotificationEvent.ToastShow, {
        title: `Background command ${entry.status}`,
        message: `${entry.description} (shell ${id}, exit ${entry.exitCode ?? "?"})`,
        variant: entry.status === "completed" ? "info" : "warning",
        duration: TOAST_DURATION_LONG_MS,
      })
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

  /** Test-only: forget all shells without killing anything. */
  export function resetForTests() {
    shells.clear()
    counter = 0
  }
}
