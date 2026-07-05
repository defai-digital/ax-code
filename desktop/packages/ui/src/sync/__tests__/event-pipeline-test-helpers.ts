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

export type SavedBrowserGlobals = {
  document: typeof globalThis.document
  window: typeof globalThis.window
  navigator: typeof globalThis.navigator
}

export function saveBrowserGlobals(): SavedBrowserGlobals {
  return {
    document: globalThis.document,
    window: globalThis.window,
    navigator: globalThis.navigator,
  }
}

export function restoreBrowserGlobals(saved: SavedBrowserGlobals): void {
  globalThis.document = saved.document
  globalThis.window = saved.window
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: saved.navigator,
  })
}

export function setNavigatorOnline(onLine: boolean): void {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine },
  })
}

export function installEventPipelineBrowserGlobals(
  options: {
    visibilityState?: "hidden" | "visible"
    onLine?: boolean
  } = {},
): { documentTarget: TestEventTarget; windowTarget: TestEventTarget } {
  const documentTarget = createEventTarget({ visibilityState: options.visibilityState ?? "visible" })
  const windowTarget = createEventTarget({
    location: { href: "http://127.0.0.1:3000/", origin: "http://127.0.0.1:3000" },
  })

  globalThis.document = documentTarget as unknown as Document
  globalThis.window = windowTarget as unknown as Window & typeof globalThis
  setNavigatorOnline(options.onLine ?? true)

  return { documentTarget, windowTarget }
}
