type TestEventHandler = () => void

export type TestEventTarget = {
  addEventListener(event: string, handler: TestEventHandler): void
  removeEventListener(event: string, handler: TestEventHandler): void
  dispatch(event: string): void
} & Record<string, unknown>

export function createEventTarget(extras: Record<string, unknown> = {}): TestEventTarget {
  const listeners = new Map<string, Set<TestEventHandler>>()

  return {
    ...extras,
    addEventListener(event, handler) {
      const list = listeners.get(event)
      if (list) list.add(handler)
      else listeners.set(event, new Set([handler]))
    },
    removeEventListener(event, handler) {
      listeners.get(event)?.delete(handler)
    },
    dispatch(event) {
      const list = listeners.get(event)
      if (!list) return
      for (const handler of Array.from(list)) {
        handler()
      }
    },
  }
}
