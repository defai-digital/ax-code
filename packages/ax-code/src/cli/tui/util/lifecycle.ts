import { Log } from "@/util/log"
import { toErrorMessage } from "@/util/error-message"
import { isHarmlessInterrupt } from "@/util/harmless-interrupt"
import type { TuiTerminalScreenMode } from "../terminal-cleanup"
import { flushTuiStdout, resetTuiTerminalState } from "../terminal-cleanup"

const log = Log.create({ service: "tui.lifecycle" })

type LifecycleLogger = Pick<Log.Logger, "warn">

type EventListenerTarget = {
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ): void
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: EventListenerOptions | boolean,
  ): void
}

type ProcessEventName = string | symbol
type ProcessHandler = (...args: unknown[]) => void

export interface TuiLifecycleOptions {
  name: string
  logger?: LifecycleLogger
}

export function runTuiCleanup(cleanup: () => void, input: TuiLifecycleOptions) {
  const logger = input.logger ?? log
  try {
    cleanup()
  } catch (error) {
    logger.warn("tui cleanup failed", { lifecycleName: input.name, error })
  }
}

export function registerTuiEventListener(
  target: EventListenerTarget,
  type: string,
  listener: EventListenerOrEventListenerObject,
  input: TuiLifecycleOptions & {
    options?: AddEventListenerOptions | boolean
  },
) {
  target.addEventListener(type, listener, input.options)
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    runTuiCleanup(() => target.removeEventListener(type, listener, input.options), input)
  }
}

export function registerTuiProcessHandler(
  event: ProcessEventName,
  handler: ProcessHandler,
  input: TuiLifecycleOptions,
) {
  process.on(event, handler)
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    runTuiCleanup(() => process.off(event, handler), input)
  }
}

type TerminalProfile = { screenMode: TuiTerminalScreenMode; useKittyKeyboard: boolean }
let terminalProfile: TerminalProfile | undefined
let terminalLifecycle: { profile: TerminalProfile; close: () => Promise<void> } | undefined

export function setTuiTerminalProfile(profile: TerminalProfile) {
  terminalProfile = profile
}

export function registerTuiTerminalLifecycle(lifecycle: NonNullable<typeof terminalLifecycle>) {
  terminalLifecycle = lifecycle
  terminalProfile = lifecycle.profile
  return () => {
    if (terminalLifecycle === lifecycle) terminalLifecycle = undefined
  }
}

export function resetActiveTuiTerminal() {
  const profile = terminalProfile
  const reset = () =>
    resetTuiTerminalState({ screenMode: profile?.screenMode, kittyKeyboard: profile?.useKittyKeyboard })
  if (!terminalLifecycle) {
    reset()
    return
  }
  return terminalLifecycle.close().finally(() => {
    reset()
  })
}

/**
 * Restore the terminal for the screen mode that is actually mounted, flush
 * stdout, then exit non-zero. A deadline forces the exit if cleanup stalls.
 */
export function exitTuiAfterCrash() {
  const deadline = tuiCrashExitDeadline()
  const timer = setTimeout(() => {
    deadline.onDeadline()
    process.exit(1)
  }, deadline.delayMs)
  timer.unref?.()
  const cleanup = resetActiveTuiTerminal()
  const flushed = cleanup ? cleanup.then(() => flushTuiStdout()) : flushTuiStdout()
  void flushed.finally(() => {
    clearTimeout(timer)
    process.exit(1)
  })
}

// Inline surfaces can be settling across several queued blocks when a fault arrives.
// Keep the legacy full-screen deadline, allowing inline commits a bounded drain.
function tuiCrashExitDeadline() {
  const profile = terminalProfile
  if (profile?.screenMode !== "split-footer") return { delayMs: 100, onDeadline: () => {} }
  return {
    delayMs: 2_000,
    onDeadline: () =>
      resetTuiTerminalState({ screenMode: profile.screenMode, kittyKeyboard: profile.useKittyKeyboard }),
  }
}

// Default crash response for a TUI foreground process (thread / attach):
// restore the terminal out of raw / mouse-tracking / alternate-screen mode so
// the shell prompt is usable again, flush stdout, then exit non-zero. Without
// this an uncaught exception leaves the terminal wedged. The returned handler
// is idempotent across the two crash events (uncaughtException +
// unhandledRejection) so a rejection following an exception doesn't schedule a
// second exit race.
export function createTuiCrashHandler(input: { onError?: (error: unknown) => void } = {}): ProcessHandler {
  let scheduled = false
  return (error: unknown) => {
    // Aborts, cancellations, and broken-pipe noise must not tear down an
    // otherwise healthy interactive session (user Esc, tool cancel, SSE reset).
    if (isHarmlessInterrupt(error)) {
      log.warn("ignored harmless process fault", { error: toErrorMessage(error) })
      return
    }
    input.onError?.(error)
    log.error("tui crashed", { error: toErrorMessage(error) })
    process.exitCode = 1
    if (scheduled) return
    scheduled = true
    exitTuiAfterCrash()
  }
}

// Default response for an unhandled promise rejection in a TUI foreground
// process: log and CONTINUE. Unlike an uncaughtException (which leaves the
// process in an undefined state and must stay fatal), a rejection typically
// comes from a fire-and-forget async UI/event handler (keyboard handlers are
// invoked without awaiting their return value) — tearing down the whole
// interactive session for one dropped promise is a disproportionate response
// and was a recurring source of "TUI vanished mid-keystroke" reports.
export function createTuiRejectionHandler(input: { onError?: (error: unknown) => void } = {}): ProcessHandler {
  return (error: unknown) => {
    if (isHarmlessInterrupt(error)) {
      log.warn("ignored harmless process fault", { error: toErrorMessage(error) })
      return
    }
    input.onError?.(error)
    log.error("unhandled rejection in tui (session continues)", { error: toErrorMessage(error) })
  }
}

// Error codes produced by writes against a stdio stream whose terminal is
// already gone (window closed, SSH drop, `exit` in the host shell). Node
// delivers these asynchronously as 'error' events on the stdout/stderr
// sockets, so the try/catch in the write helpers (terminal-cleanup.ts,
// renderer.ts) can never see them. Without an 'error' listener each one
// escalates to uncaughtException — and the crash handler's own terminal-reset
// write re-triggers it, crash-looping the process with repeated "write EIO"
// fatals (observed on tty loss).
const DEAD_STDIO_ERROR_CODES = new Set(["EIO", "EPIPE", "ECONNRESET", "ERR_STREAM_DESTROYED"])

type ErrorEmitter = {
  on(event: "error", listener: (error: unknown) => void): unknown
  off(event: "error", listener: (error: unknown) => void): unknown
}

// Swallow dead-stdio 'error' events on the given streams (defaults to
// process.stdout + process.stderr) so a vanished terminal cannot kill the
// process through async write failures. Unknown error codes are re-thrown,
// preserving the previous uncaughtException behavior for genuinely broken
// streams. Returns an unregister for the installed listeners.
export function guardTuiStdioErrors(
  input: TuiLifecycleOptions & { streams?: ErrorEmitter[] } = { name: "tui-stdio-guard" },
) {
  const logger = input.logger ?? log
  const streams = input.streams ?? [process.stdout, process.stderr]
  const unregister = streams.map((stream) => {
    const listener = (error: unknown) => {
      const code = (error as { code?: unknown } | null)?.code
      if (typeof code === "string" && DEAD_STDIO_ERROR_CODES.has(code)) {
        logger.warn("ignored dead-stdio write error", { lifecycleName: input.name, code })
        return
      }
      throw error
    }
    stream.on("error", listener)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      runTuiCleanup(() => stream.off("error", listener), input)
    }
  })
  return () => {
    for (const off of unregister) off()
  }
}

// Register a crash handler on fatal process events and return a single
// unregister for the pair. Shared by thread.ts (passes its own handler that
// also records diagnostics) and attach.ts (uses createTuiCrashHandler) so both
// entrypoints restore terminal state on an uncaught error. uncaughtException
// stays fatal; unhandledRejection defaults to the log-and-continue handler
// above unless the caller supplies `onRejection`.
export function registerTuiCrashHandlers(
  handler: ProcessHandler,
  input: { namePrefix?: string; onRejection?: ProcessHandler } = {},
) {
  const prefix = input.namePrefix ?? "tui"
  const unregister = [
    guardTuiStdioErrors({ name: `${prefix}-stdio-guard` }),
    registerTuiProcessHandler("uncaughtException", handler, { name: `${prefix}-uncaught-exception` }),
    registerTuiProcessHandler("unhandledRejection", input.onRejection ?? createTuiRejectionHandler(), {
      name: `${prefix}-unhandled-rejection`,
    }),
  ]
  return () => {
    for (const off of unregister) off()
  }
}
