export interface BootstrapController {
  run: () => Promise<void>
  runInBackground: () => void
}

export function createBootstrapController(input: {
  run: () => void | Promise<void>
  onBackgroundFailure?: (error: unknown) => void
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
      void run().catch((error) => input.onBackgroundFailure?.(error))
    },
  }
}
