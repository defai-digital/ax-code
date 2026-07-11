import { Log } from "@/util/log"
import { toErrorMessage } from "@/util/error-message"
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
    input.onError?.(error)
    log.error("tui crashed", { error: toErrorMessage(error) })
    process.exitCode = 1
    resetTuiTerminalState()
    if (scheduled) return
    scheduled = true
    const timer = setTimeout(() => process.exit(1), 100)
    timer.unref?.()
    void flushTuiStdout().finally(() => {
      clearTimeout(timer)
      process.exit(1)
    })
  }
}

// Register a crash handler on both fatal process events and return a single
// unregister for the pair. Shared by thread.ts (passes its own handler that
// also records diagnostics) and attach.ts (uses createTuiCrashHandler) so both
// entrypoints restore terminal state on an uncaught error.
export function registerTuiCrashHandlers(handler: ProcessHandler, input: { namePrefix?: string } = {}) {
  const prefix = input.namePrefix ?? "tui"
  const unregister = [
    registerTuiProcessHandler("uncaughtException", handler, { name: `${prefix}-uncaught-exception` }),
    registerTuiProcessHandler("unhandledRejection", handler, { name: `${prefix}-unhandled-rejection` }),
  ]
  return () => {
    for (const off of unregister) off()
  }
}
