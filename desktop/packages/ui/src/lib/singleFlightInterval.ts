export type SingleFlightIntervalTask = (isCancelled: () => boolean) => void | Promise<void>

type SingleFlightIntervalOptions = {
  immediate?: boolean
  onError?: (error: unknown) => void
}

export function startSingleFlightInterval(
  task: SingleFlightIntervalTask,
  intervalMs: number,
  options: SingleFlightIntervalOptions = {},
): () => void {
  let cancelled = false
  let running = false

  const poll = () => {
    if (cancelled || running) return
    running = true
    void Promise.resolve()
      .then(() => task(() => cancelled))
      .catch((error) => {
        try { options.onError?.(error) } catch { /* swallow onError failure */ }
      })
      .finally(() => {
        running = false
      })
  }

  const intervalId = window.setInterval(poll, intervalMs)
  if (options.immediate) poll()

  return () => {
    cancelled = true
    window.clearInterval(intervalId)
  }
}
