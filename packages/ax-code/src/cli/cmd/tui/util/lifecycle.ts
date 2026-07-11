import { Log } from "@/util/log"

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
