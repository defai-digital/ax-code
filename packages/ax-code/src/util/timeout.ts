// Resolve after `ms`, with the timer unref'd so a pending sleep never keeps
// the process alive (e.g. a lock poll loop during shutdown).
export function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message?: string): Promise<T> {
  // Manual race implementation so that a post-timeout rejection from
  // `promise` does not become an unhandled rejection. The previous
  // Promise.race pattern left the original promise unhandled once the
  // timer fired — if it later rejected (e.g. an LSP RPC that errored
  // after the tool already returned), Node would log an
  // `unhandledRejection` warning or crash with
  // `--unhandled-rejections=throw`.
  let settled = false
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(message ?? `Operation timed out after ${ms}ms`))
    }, ms)
    promise.then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}
