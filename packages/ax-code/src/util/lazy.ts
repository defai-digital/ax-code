export type Lazy<T> = (() => T) & {
  reset(): void
  peek(): T | undefined
  loaded(): boolean
}

export function lazy<T>(fn: () => T): Lazy<T> {
  let value: T | undefined
  let loaded = false

  const result = (() => {
    // Return cached value if already initialized and not reset
    if (loaded) return value as T
    try {
      value = fn()
      loaded = true
      return value as T
    } catch (e) {
      // Don't mark as loaded if initialization failed
      throw e
    }
  }) as Lazy<T>

  result.reset = () => {
    loaded = false
    value = undefined
  }

  result.peek = () => (loaded ? value : undefined)
  result.loaded = () => loaded

  return result
}
