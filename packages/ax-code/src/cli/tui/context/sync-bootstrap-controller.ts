import { runTuiBackgroundTask, type TuiBackgroundTaskLogger } from "../util/background-task"

export interface BootstrapController {
  run: () => Promise<void>
  runInBackground: () => void
}

export function createBootstrapController(input: {
  name: string
  run: () => void | Promise<void>
  onBackgroundFailure?: (error: unknown) => void
  logger?: TuiBackgroundTaskLogger
}): BootstrapController {
  let inFlight: Promise<void> | undefined

  const run = () => {
    if (inFlight) return inFlight
    inFlight = Promise.resolve()
      .then(input.run)
      .finally(() => {
        inFlight = undefined
      })
    return inFlight
  }

  return {
    run,
    runInBackground() {
      runTuiBackgroundTask(run, {
        name: input.name,
        logger: input.logger,
        onError: input.onBackgroundFailure,
      })
    },
  }
}
