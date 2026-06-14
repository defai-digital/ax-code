export function lazy<T>(fn: () => T) {
  let value: T | undefined
  let loaded = false

  return (): T => {
    if (loaded) return value as T
    // Mark loaded only after fn() succeeds. If it throws synchronously, the
    // value stays uncomputed so the next call retries instead of permanently
    // returning undefined.
    value = fn()
    loaded = true
    return value as T
  }
}
