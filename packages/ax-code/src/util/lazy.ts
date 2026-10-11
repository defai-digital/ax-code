export type Lazy<T> = (() => T) & {
  reset(): void
  peek(): T | undefined
  loaded(): boolean
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === "function"
  )
}

export function lazy<T>(fn: () => T): Lazy<T> {
  let value: T | undefined
  let loaded = false

  const result = (() => {
    // Return cached value if already initialized and not reset
    if (loaded) return value as T
    try {
      const produced = fn()
      value = produced
      loaded = true
      // An async initializer settles later: a rejected promise is a failed
      // initialization too, so forget it (unless the slot moved on) and let
      // the next call retry instead of replaying the same rejection forever.
      if (isThenable(produced)) {
        produced.then(undefined, () => {
          if (loaded && value === produced) {
            loaded = false
            value = undefined
          }
        })
      }
      return produced
    } catch (e) {
      // The thenable probe and subscription can throw after the slot is
      // published. Treat those failures like a throwing initializer too.
      loaded = false
      value = undefined
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
