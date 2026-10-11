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
    const produced = fn()
    // An async initializer settles later: a rejected promise is a failed
    // initialization too, so forget it (unless the slot moved on) and let
    // the next call retry instead of replaying the same rejection forever.
    // Publish before subscribing: a thenable that rejects synchronously (a
    // test double, a settled custom thenable) must find the slot loaded so
    // the reset below applies. A `then` that itself throws is a failed
    // initialization too: unload the slot and surface the throw.
    value = produced
    loaded = true
    try {
      // Reading `.then` may itself throw (a getter), so the probe stays inside.
      if (isThenable(produced)) {
        produced.then(
          () => undefined,
          () => {
            if (loaded && value === produced) {
              loaded = false
              value = undefined
            }
          },
        )
      }
    } catch (error) {
      loaded = false
      value = undefined
      throw error
    }
    return produced
  }) as Lazy<T>

  result.reset = () => {
    loaded = false
    value = undefined
  }

  result.peek = () => (loaded ? value : undefined)
  result.loaded = () => loaded

  return result
}
