import { runTuiBackgroundTask, type TuiBackgroundTaskLogger } from "./background-task"

export function scheduleDeferredStartupTask(
  task: () => void | Promise<void>,
  input: {
    name: string
    delayMs?: number
    onError?: (error: unknown) => void
    logger?: TuiBackgroundTaskLogger
  },
) {
  let cancelled = false
  let cancelTask: (() => void) | undefined
  const timer = setTimeout(() => {
    if (cancelled) return
    cancelTask = runTuiBackgroundTask(task, input)
  }, input.delayMs ?? 0)

  return () => {
    cancelled = true
    clearTimeout(timer)
    cancelTask?.()
  }
}
