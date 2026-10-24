import type { ChildProcess } from "child_process"
import { StringDecoder } from "string_decoder"
import { BackgroundOutputSpool } from "./background-output-spool"
import { safeUtf8PrefixLength } from "./bash-helpers"
import { Log } from "../util/log"
import { Shell } from "@/shell/shell"
import { Bus } from "@/bus"
import { NotificationEvent } from "@/notification/events"
import { TOAST_DURATION_LONG_MS } from "@/constants/server"
import { abortError } from "@/util/abort"
import { ProcessRegistry } from "@/runtime/process-registry"
import { BackgroundNotification } from "../session/background-notification"

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
  export type OutputStream = "stdout" | "stderr"

  export interface Observer {
    onOutput?(stream: OutputStream, text: string): void
    onExit?(info: Info): void
  }

  const MAX_OBSERVER_BACKLOG_BYTES = 64 * 1024
  const MAX_OBSERVER_BACKLOG_RECORDS = 128
  const MAX_GLOBAL_OBSERVER_BYTES = 2 * 1024 * 1024
  const MAX_SHELLS_PER_SESSION = 16
  const MAX_ACTIVE_SHELLS = 32
  const MAX_FINISHED_PER_SESSION = 16
  const MAX_FINISHED_SHELLS = 64
  const FINISHED_TTL_MS = 30 * 60 * 1000
  const MAX_COMMAND_PREVIEW_BYTES = 8 * 1024
  const MAX_DESCRIPTION_PREVIEW_BYTES = 1024

  export interface Info {
    id: string
    sessionID: string
    command: string
    description: string
    status: Status
    exitCode: number | null
    startedAt: number
    endedAt: number | null
    /** Output integrity is independent of command exit status and remains sticky across reads. */
    outputStatus: BackgroundOutputSpool["integrity"]
    metadataTruncated: boolean
  }

  interface Entry extends Omit<Info, "outputStatus"> {
    proc?: ChildProcess
    spool: BackgroundOutputSpool
    exited: boolean
    killRequested: boolean
    onExited?: () => void
    observers: Set<Observer>
    observerBacklog: Array<{ stream: OutputStream; text: string }>
    observerBacklogBytes: number
    observerBacklogReplayed: boolean
    observerBacklogDropped: boolean
  }

  const shells = new Map<string, Entry>()
  let counter = 0
  let observerBytes = 0
  let retentionTimer: ReturnType<typeof setInterval> | undefined

  export function assertCapacity(sessionID: string) {
    const active = list(sessionID).filter((s) => s.status === "running")
    if (
      active.length >= MAX_SHELLS_PER_SESSION ||
      list().filter((s) => s.status === "running").length >= MAX_ACTIVE_SHELLS
    ) {
      throw new Error(
        `Too many running background shells (limit ${MAX_SHELLS_PER_SESSION} per session, ${MAX_ACTIVE_SHELLS} per process). ` +
          `Use kill_shell to terminate ones you no longer need, or wait for them to finish.`,
      )
    }
  }

  function clearBacklog(entry: Entry) {
    observerBytes -= entry.observerBacklogBytes
    entry.observerBacklog = []
    entry.observerBacklogBytes = 0
  }

  function forget(entry: Entry) {
    entry.spool.dispose()
    clearBacklog(entry)
    shells.delete(entry.id)
    if (!shells.size && retentionTimer) {
      clearInterval(retentionTimer)
      retentionTimer = undefined
    }
  }

  function expireFinished() {
    for (const entry of shells.values()) {
      if (entry.endedAt === null || Date.now() - entry.endedAt < FINISHED_TTL_MS) continue
      entry.spool.expire()
      if (entry.observerBacklog.length) entry.observerBacklogDropped = true
      clearBacklog(entry)
    }
  }

  function evictFinished(sessionID: string) {
    const finished = [...shells.values()]
      .filter((s) => s.status !== "running")
      .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0))
    const sessionFinished = finished.filter((s) => s.sessionID === sessionID)
    while (sessionFinished.length > MAX_FINISHED_PER_SESSION) forget(sessionFinished.shift()!)
    const remaining = finished.filter((s) => shells.has(s.id))
    while (remaining.length > MAX_FINISHED_SHELLS) forget(remaining.shift()!)
  }

  function preview(text: string, limit: number) {
    // Slice before encoding so an arbitrarily long command does not create a retained/temporary duplicate.
    const bytes = Buffer.from(text.slice(0, limit))
    const end = safeUtf8PrefixLength(bytes, limit)
    return { text: bytes.toString("utf8", 0, end), truncated: text.length > limit || end < bytes.length }
  }

  /** Bounded unread-output tail included in exit notifications. */
  const EXIT_NOTIFICATION_TAIL_BYTES = 2048

  export function register(input: {
    sessionID: string
    command: string
    description: string
    proc: ChildProcess
    /** Output captured before adoption (foreground timeout path); seeds the spool. */
    seedOutput?: string
    onExited?: () => void
  }): Info {
    const proc = input.proc
    assertCapacity(input.sessionID)
    evictFinished(input.sessionID)
    counter += 1
    const id = `bash_${counter}`
    const command = preview(input.command, MAX_COMMAND_PREVIEW_BYTES)
    const description = preview(input.description, MAX_DESCRIPTION_PREVIEW_BYTES)
    const entry: Entry = {
      id,
      sessionID: input.sessionID,
      command: command.text,
      description: description.text,
      metadataTruncated: command.truncated || description.truncated,
      status: "running",
      exitCode: null,
      startedAt: Date.now(),
      endedAt: null,
      proc,
      spool: new BackgroundOutputSpool(),
      exited: false,
      killRequested: false,
      onExited: input.onExited,
      observers: new Set(),
      observerBacklog: [],
      observerBacklogBytes: 0,
      observerBacklogReplayed: false,
      observerBacklogDropped: false,
    }
    shells.set(id, entry)
    retentionTimer ??= setInterval(expireFinished, 60_000).unref()

    // ADR-209: record the shell for the startup orphan sweep. Background
    // shells are spawned detached, so the child is its own group leader and
    // a sweep signals the whole group. Best effort; failures are logged
    // inside the registry and never affect the shell.
    if (proc.pid) {
      void ProcessRegistry.register({ pid: proc.pid, pgid: proc.pid, kind: "shell", command: entry.command })
    }

    // Seed before any stream listener can fire so the adopted history stays
    // ordered ahead of live output. The spool enforces its own size caps.
    if (input.seedOutput) entry.spool.append(input.seedOutput)

    const appendText = (stream: OutputStream, text: string) => {
      if (!text || entry.status !== "running" || shells.get(id) !== entry) return
      entry.spool.append(text)
      if (entry.observers.size === 0 && !entry.observerBacklogReplayed) {
        const remaining = Math.min(
          MAX_OBSERVER_BACKLOG_BYTES - entry.observerBacklogBytes,
          MAX_GLOBAL_OBSERVER_BYTES - observerBytes,
        )
        const replay = preview(text, Math.max(0, remaining))
        if (replay.text && entry.observerBacklog.length < MAX_OBSERVER_BACKLOG_RECORDS) {
          const bytes = Buffer.byteLength(replay.text)
          entry.observerBacklog.push({ stream, text: replay.text })
          entry.observerBacklogBytes += bytes
          observerBytes += bytes
          if (replay.truncated) entry.observerBacklogDropped = true
        } else {
          entry.observerBacklogDropped = true
        }
      }
      for (const observer of entry.observers) {
        try {
          observer.onOutput?.(stream, text)
        } catch (error) {
          log.warn("background shell observer output failed", {
            id,
            error: error instanceof Error ? error.message : error,
          })
        }
      }
    }
    // Per-stream decoders: a 'data' chunk can split a multi-byte UTF-8
    // character, and Buffer#toString would emit replacement characters at
    // the boundary. StringDecoder buffers the partial sequence instead.
    const stdoutDecoder = new StringDecoder("utf8")
    const stderrDecoder = new StringDecoder("utf8")
    proc.stdout?.on("data", (chunk: Buffer) => appendText("stdout", stdoutDecoder.write(chunk)))
    proc.stderr?.on("data", (chunk: Buffer) => appendText("stderr", stderrDecoder.write(chunk)))

    // bash_input writes can race with process exit: EPIPE then arrives
    // asynchronously on the stdin stream. Log-and-swallow here so a stray
    // EPIPE never becomes an uncaught exception; write() reports failures
    // to its own caller through a dedicated one-shot listener.
    proc.stdin?.on("error", (error) => {
      log.warn("background shell stdin error", { id, error: error instanceof Error ? error.message : error })
    })

    proc.once("exit", () => {
      entry.exited = true
      // Grandchildren spawned by the command inherit the pipe FDs and can
      // hold 'close' open indefinitely; destroy after one I/O cycle so the
      // streams drain, mirroring the foreground bash path.
      setImmediate(() => {
        proc.stdout?.destroy()
        proc.stderr?.destroy()
      })
    })

    proc.once("close", () => {
      appendText("stdout", stdoutDecoder.end())
      appendText("stderr", stderrDecoder.end())
      const status = entry.killRequested ? "killed" : proc.exitCode === 0 ? "completed" : "failed"
      finish(entry, status, proc.exitCode)
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
        // ADR-259: observation-only Notification hook (background task
        // complete). No command text or description — the shell id, status
        // and exit code identify the task without secrets. Fire-and-forget.
        void import("@/hooks/lifecycle")
          .then(({ LifecycleHooks }) =>
            LifecycleHooks.runForWorkspace({
              event: "Notification",
              sessionID: entry.sessionID,
              args: {
                sessionID: entry.sessionID,
                kind: "background_task",
                shellID: id,
                status: entry.status,
                exitCode: entry.exitCode,
              },
            }),
          )
          .catch((error) => log.warn("Notification lifecycle hooks failed", { id, error }))
      } catch (error) {
        log.warn("background shell toast publish failed", { id, error: error instanceof Error ? error.message : error })
      }
    })

    proc.once("error", (error) => {
      appendText("stderr", `\n[background shell error] ${error instanceof Error ? error.message : String(error)}`)
      finish(entry, "failed", proc.exitCode)
    })

    log.info("background shell started", { id, pid: proc.pid, sessionID: input.sessionID })
    return toInfo(entry)
  }

  function finish(entry: Entry, status: Status, exitCode: number | null) {
    if (entry.status !== "running") return
    const registryPid = entry.proc?.pid
    entry.exited = true
    entry.status = status
    entry.exitCode = exitCode
    entry.endedAt = Date.now()
    entry.spool.finishedAt = entry.endedAt
    entry.onExited?.()
    entry.onExited = undefined
    entry.proc = undefined
    // Deliberate kills (kill_shell, monitor timeout, session teardown) are
    // already known to their initiator; only natural exits notify.
    if (status !== "killed") {
      try {
        BackgroundNotification.recordShellExit({
          sessionID: entry.sessionID,
          shellID: entry.id,
          description: entry.description,
          status,
          exitCode,
          durationMs: entry.endedAt - entry.startedAt,
          outputTail: entry.spool.peekTail(EXIT_NOTIFICATION_TAIL_BYTES),
          outputIntegrity: entry.spool.integrity,
        })
      } catch {
        // Notification recording is best-effort; exit handling continues.
      }
    }
    const info = toInfo(entry)
    for (const observer of entry.observers) {
      try {
        observer.onExit?.(info)
      } catch (error) {
        log.warn("background shell observer exit failed", {
          id: entry.id,
          error: error instanceof Error ? error.message : error,
        })
      }
    }
    entry.observers.clear()
    evictFinished(entry.sessionID)
    // ADR-209: every terminal state (completed, failed, killed) removes the
    // registry entry so only a hard owner death leaves one behind.
    if (registryPid) void ProcessRegistry.unregister(registryPid, "shell")
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
      outputStatus: entry.spool.integrity,
      metadataTruncated: entry.metadataTruncated,
    }
  }

  export function get(id: string, sessionID?: string): Info | undefined {
    expireFinished()
    const entry = shells.get(id)
    if (!entry) return undefined
    if (sessionID !== undefined && entry.sessionID !== sessionID) return undefined
    return toInfo(entry)
  }

  export function list(sessionID?: string): Info[] {
    expireFinished()
    return [...shells.values()].filter((s) => sessionID === undefined || s.sessionID === sessionID).map(toInfo)
  }

  /**
   * Observe decoded output without consuming the incremental bash_output
   * cursor. A short backlog is replayed so a fast command cannot finish
   * between BashTool returning and its caller attaching the observer.
   */
  export function observe(id: string, sessionID: string, observer: Observer): (() => void) | undefined {
    expireFinished()
    const entry = shells.get(id)
    if (!entry || entry.sessionID !== sessionID) return undefined

    entry.observers.add(observer)
    if (!entry.observerBacklogReplayed) {
      entry.observerBacklogReplayed = true
      for (const chunk of entry.observerBacklog) {
        try {
          observer.onOutput?.(chunk.stream, chunk.text)
        } catch (error) {
          log.warn("background shell observer backlog failed", {
            id,
            error: error instanceof Error ? error.message : error,
          })
        }
      }
      clearBacklog(entry)
      if (entry.observerBacklogDropped) {
        try {
          observer.onOutput?.(
            "stderr",
            "\n[background observer replay truncated or expired; inspect bash_output integrity]\n",
          )
        } catch (error) {
          log.warn("background shell observer notice failed", { id, error: String(error) })
        }
      }
    }
    if (entry.status !== "running") {
      try {
        observer.onExit?.(toInfo(entry))
      } catch (error) {
        log.warn("background shell observer initial exit failed", {
          id,
          error: error instanceof Error ? error.message : error,
        })
      }
      entry.observers.delete(observer)
    }

    return () => {
      entry.observers.delete(observer)
    }
  }

  /**
   * Resolve once every shell that belongs to `sessionID` and is running at
   * call time has finished. A session with no running shell resolves
   * immediately, and a shell that finishes between the snapshot and the
   * observer attach is settled by observe's initial exit callback. The
   * observers and the abort listener are always released on completion or
   * abort.
   */
  export async function waitForCompletion(sessionID: string, opts: { signal?: AbortSignal } = {}): Promise<void> {
    if (opts.signal?.aborted) throw abortError()
    const running = list(sessionID).filter((entry) => entry.status === "running")
    if (running.length === 0) return

    await new Promise<void>((resolve, reject) => {
      let remaining = running.length
      let settled = false
      const unsubscribers: Array<() => void> = []
      const settle = (error?: Error) => {
        if (settled) return
        settled = true
        opts.signal?.removeEventListener("abort", onAbort)
        for (const unsubscribe of unsubscribers) unsubscribe()
        if (error) reject(error)
        else resolve()
      }
      const onAbort = () => settle(abortError())
      opts.signal?.addEventListener("abort", onAbort, { once: true })

      for (const shell of running) {
        const unsubscribe = observe(shell.id, sessionID, {
          onExit: () => {
            remaining -= 1
            if (remaining <= 0) settle()
          },
        })
        if (unsubscribe) {
          unsubscribers.push(unsubscribe)
          // observe can call onExit synchronously for an already-finished
          // entry, which settles before this unsubscriber is registered.
          if (settled) unsubscribe()
        } else {
          // The shell was forgotten between the snapshot and observe, so it
          // cannot produce another exit callback.
          remaining -= 1
          if (remaining <= 0) settle()
        }
      }
      if (!settled && remaining <= 0) settle()
    })
    if (opts.signal?.aborted) throw abortError()
  }

  /** Wait until this shell has unread output, exits, the timeout elapses, or abort fires. Then consume like read(). */
  export async function waitAndRead(
    id: string,
    sessionID: string,
    opts: { timeoutMs: number; signal?: AbortSignal },
  ): Promise<{ info: Info; output: string; dropped: boolean } | undefined> {
    expireFinished()
    const entry = shells.get(id)
    if (!entry || entry.sessionID !== sessionID) return undefined
    if (opts.signal?.aborted) throw abortError()

    const hasUnread = entry.spool.unreadBytes > 0 || entry.spool.integrity === "storage_error"
    if (entry.status === "running" && !hasUnread && opts.timeoutMs > 0) {
      await new Promise<void>((resolve, reject) => {
        let settled = false
        let timer: ReturnType<typeof setTimeout> | undefined
        let unsub: (() => void) | undefined
        const settle = (error?: Error) => {
          if (settled) return
          settled = true
          if (timer !== undefined) clearTimeout(timer)
          unsub?.()
          opts.signal?.removeEventListener("abort", onAbort)
          if (error) reject(error)
          else resolve()
        }
        const onAbort = () => settle(abortError())
        timer = setTimeout(() => settle(), opts.timeoutMs)
        opts.signal?.addEventListener("abort", onAbort, { once: true })
        // Ignore already-consumed observer backlog so a second wait is not
        // woken by output read() already returned. Only future output/exit.
        unsub = observe(id, sessionID, {
          onOutput: () => {
            if (entry.spool.unreadBytes > 0 || entry.spool.integrity === "storage_error") settle()
          },
          onExit: () => settle(),
        })
        if (settled) unsub?.()
      })
      if (opts.signal?.aborted) throw abortError()
    }

    return read(id, sessionID)
  }

  /** Return output produced since the previous read() for this shell. */
  export function read(id: string, sessionID?: string): { info: Info; output: string; dropped: boolean } | undefined {
    expireFinished()
    const entry = shells.get(id)
    if (!entry) return undefined
    if (sessionID !== undefined && entry.sessionID !== sessionID) return undefined
    const { output, dropped } = entry.spool.read()
    const info = toInfo(entry)
    if (entry.status !== "running") forget(entry)
    return { info, output, dropped }
  }

  /**
   * Write to a running shell's stdin (bash_input). Throws on unknown or
   * cross-session shells, on shells that are no longer running, and on the
   * EPIPE/write-after-exit race (the process may exit between lookup and
   * write). When `eof` is set, stdin is closed after the write so commands
   * that read until end-of-input (e.g. `cat`) can finish.
   */
  export async function write(id: string, sessionID: string, data: string, opts: { eof?: boolean }): Promise<Info> {
    expireFinished()
    const entry = shells.get(id)
    if (!entry || entry.sessionID !== sessionID) {
      throw new Error(
        `No background shell with ID "${id}" in this session. Call bash_output without shell_id to list available shells.`,
      )
    }
    if (entry.status !== "running" || entry.exited) {
      throw new Error(
        `Background shell "${id}" is ${entry.status} — stdin is closed. Its output remains readable via bash_output.`,
      )
    }
    const stdin = entry.proc?.stdin
    if (!stdin || stdin.destroyed || stdin.writableEnded || !stdin.writable) {
      throw new Error(`Background shell "${id}" stdin is no longer writable (the process may have just exited).`)
    }
    await new Promise<void>((resolve, reject) => {
      const fail = (error: unknown) =>
        reject(
          new Error(
            `Failed to write to background shell "${id}" — the process exited while writing: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        )
      const onError = (error: Error) => fail(error)
      stdin.once("error", onError)
      const done = (error?: Error | null) => {
        stdin.removeListener("error", onError)
        if (error) fail(error)
        else resolve()
      }
      try {
        if (opts.eof) stdin.end(data, done)
        else stdin.write(data, done)
      } catch (error) {
        // Write-after-exit can also fail synchronously (ERR_STREAM_DESTROYED).
        stdin.removeListener("error", onError)
        fail(error)
      }
    })
    return toInfo(entry)
  }

  export async function kill(id: string, sessionID?: string): Promise<Info | undefined> {
    expireFinished()
    const entry = shells.get(id)
    if (!entry) return undefined
    if (sessionID !== undefined && entry.sessionID !== sessionID) return undefined
    if (entry.status === "running") {
      entry.killRequested = true
      const proc = entry.proc!
      await Shell.killTree(proc, { exited: () => entry.exited })
      finish(entry, "killed", proc.exitCode)
    }
    return toInfo(entry)
  }

  /** Kill and forget every shell belonging to a session (used on session removal). */
  export async function killForSession(sessionID: string): Promise<void> {
    for (const entry of [...shells.values()]) {
      if (entry.sessionID !== sessionID) continue
      if (entry.status === "running") {
        entry.killRequested = true
        const proc = entry.proc!
        await Shell.killTree(proc, { exited: () => entry.exited }).catch(() => undefined)
        finish(entry, "killed", proc.exitCode)
      }
      forget(entry)
    }
  }

  export function retentionStatsForTests() {
    expireFinished()
    return {
      shells: shells.size,
      observerBytes,
      observerRecords: [...shells.values()].reduce((n, s) => n + s.observerBacklog.length, 0),
      ...BackgroundOutputSpool.statsForTests(),
    }
  }

  /** Test-only: forget all shells without killing anything. */
  export function resetForTests() {
    for (const entry of shells.values()) forget(entry)
    BackgroundOutputSpool.reset()
    BackgroundNotification.resetForTests()
    counter = 0
  }
}
