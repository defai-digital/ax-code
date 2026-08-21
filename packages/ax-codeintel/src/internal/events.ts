// Minimal in-process pub/sub for @ax-code/ax-codeintel internal event flow.
// Cross-process/host event propagation (e.g. the ax-code core Bus) is handled
// by the host port; this only serves listeners inside the package.

type Handler<T> = (payload: T) => void

const handlers = new Map<string, Set<Handler<never>>>()

export namespace InternalBus {
  export function publish<T>(type: string, payload: T): void {
    const set = handlers.get(type)
    if (!set) return
    for (const handler of [...set]) (handler as Handler<T>)(payload)
  }

  export function subscribe<T>(type: string, handler: Handler<T>): () => void {
    let set = handlers.get(type)
    if (!set) {
      set = new Set()
      handlers.set(type, set)
    }
    set.add(handler as Handler<never>)
    return () => {
      set.delete(handler as Handler<never>)
    }
  }
}
