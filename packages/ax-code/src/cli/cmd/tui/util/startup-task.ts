import { Log } from "@/util/log"

const log = Log.create({ service: "tui.startup-task" })

type StartupTaskLogger = Pick<Log.Logger, "warn">

export function scheduleDeferredStartupTask(
  task: () => void | Promise<void>,
  input: {
    name?: string
    delayMs?: number
    onError?: (error: unknown) => void
    logger?: StartupTaskLogger
  } = {},
) {
  let cancelled = false
  const taskName = input.name ?? "anonymous"
  const logger = input.logger ?? log
  const timer = setTimeout(() => {
    if (cancelled) return
    void Promise.resolve()
      .then(task)
      .catch((error) => {
        if (cancelled) return
        if (input.onError) {
          try {
            input.onError(error)
          } catch (handlerError) {
            logger.warn("deferred startup task error handler failed", {
              taskName,
              error: handlerError,
              originalError: error,
            })
          }
          return
        }
        logger.warn("deferred startup task failed", { taskName, error })
      })
  }, input.delayMs ?? 0)

  return () => {
    cancelled = true
    clearTimeout(timer)
  }
}
