export function scheduleMicrotaskTask(
  task: () => void | Promise<void>,
  input: {
    onError?: (error: unknown) => void
  } = {},
) {
  let cancelled = false

  void Promise.resolve()
    .then(() => {
      if (cancelled) return
      return task()
    })
    .catch((error) => {
      if (cancelled) return
      input.onError?.(error)
    })

  return () => {
    cancelled = true
  }
}
