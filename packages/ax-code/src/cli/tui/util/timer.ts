import { runTuiBackgroundTask, type TuiBackgroundTaskLogger } from "./background-task"

type TimerHandle = ReturnType<typeof setTimeout>

export interface TuiTimerOptions {
  name: string
  delayMs: number
  unref?: boolean
  onError?: (error: unknown) => void
  logger?: TuiBackgroundTaskLogger
}

export interface TuiIntervalOptions extends TuiTimerOptions {
  allowOverlap?: boolean
}

function unrefTimer(handle: TimerHandle, enabled: boolean | undefined) {
  if (!enabled) return
  handle.unref?.()
}

export function scheduleTuiTimeout(task: () => void | Promise<void>, input: TuiTimerOptions) {
  let cancelled = false
  let cancelTask: (() => void) | undefined
  const timer = setTimeout(() => {
    if (cancelled) return
    cancelTask = runTuiBackgroundTask(task, input)
  }, input.delayMs)
  unrefTimer(timer, input.unref)

  return () => {
    cancelled = true
    clearTimeout(timer)
    cancelTask?.()
  }
}

export function scheduleTuiInterval(task: () => void | Promise<void>, input: TuiIntervalOptions) {
  let cancelled = false
  let running = false
  const cancelTasks = new Set<() => void>()

  const run = () => {
    if (cancelled) return
    if (running && !input.allowOverlap) return
    running = true
    const cancelTask = runTuiBackgroundTask(
      () =>
        Promise.resolve()
          .then(task)
          .finally(() => {
            running = false
            cancelTasks.delete(cancelTask)
          }),
      input,
    )
    cancelTasks.add(cancelTask)
  }

  const timer = setInterval(run, input.delayMs)
  unrefTimer(timer, input.unref)

  return () => {
    cancelled = true
    clearInterval(timer)
    for (const cancelTask of cancelTasks) {
      cancelTask()
    }
    cancelTasks.clear()
  }
}
