import { Log } from "@/util/log"

const log = Log.create({ service: "tui.background-task" })

export type TuiBackgroundTaskLogger = Pick<Log.Logger, "warn">

export interface TuiBackgroundTaskOptions {
  name: string
  onError?: (error: unknown) => void
  logger?: TuiBackgroundTaskLogger
}

export function reportTuiBackgroundTaskFailure(error: unknown, input: TuiBackgroundTaskOptions) {
  const logger = input.logger ?? log
  if (input.onError) {
    try {
      input.onError(error)
    } catch (handlerError) {
      logger.warn("tui background task error handler failed", {
        taskName: input.name,
        error: handlerError,
        originalError: error,
      })
    }
    return
  }
  logger.warn("tui background task failed", { taskName: input.name, error })
}

export function runTuiBackgroundTask(task: () => void | Promise<void>, input: TuiBackgroundTaskOptions) {
  let cancelled = false

  void Promise.resolve()
    .then(() => {
      if (cancelled) return
      return task()
    })
    .catch((error) => {
      if (cancelled) return
      reportTuiBackgroundTaskFailure(error, input)
    })

  return () => {
    cancelled = true
  }
}
