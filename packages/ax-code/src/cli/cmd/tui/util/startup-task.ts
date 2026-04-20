export function scheduleDeferredStartupTask(
  task: () => void | Promise<void>,
  input: {
    delayMs?: number
    onError?: (error: unknown) => void
  } = {},
) {
  let cancelled = false
  const timer = setTimeout(() => {
    if (cancelled) return
    void Promise.resolve()
      .then(task)
      .catch((error) => {
        if (cancelled) return
        input.onError?.(error)
      })
  }, input.delayMs ?? 0)

  return () => {
    cancelled = true
    clearTimeout(timer)
  }
}
