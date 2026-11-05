import { runTuiBackgroundTask, type TuiBackgroundTaskLogger } from "../util/background-task"

export interface BootstrapController {
  run: (options?: { force?: boolean }) => Promise<void>
  runInBackground: () => void
}

export function createBootstrapController(input: {
  name: string
  run: () => void | Promise<void>
  onBackgroundFailure?: (error: unknown) => void
  logger?: TuiBackgroundTaskLogger
}): BootstrapController {
  let inFlight: Promise<void> | undefined
  let queued: Promise<void> | undefined

  const run: BootstrapController["run"] = (options) => {
    if (inFlight) {
      if (!options?.force) return inFlight
      // Recovery must read state after the disconnected run, even if that
      // older request fails. Coalesce refreshes into one following run.
      queued ??= inFlight
        .catch(() => undefined)
        .then(() => {
          queued = undefined
          return run()
        })
      return queued
    }
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
