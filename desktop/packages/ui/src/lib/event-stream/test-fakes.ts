/**
 * Shared browser fakes for the event-stream tests. Mirrors the stubbing
 * pattern from src/sync/__tests__/event-pipeline-test-helpers.ts: manual
 * WebSocket / EventSource implementations recorded on a static instances list
 * and driven by explicit emit* calls.
 */

export class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []

  url: string | URL
  readyState = FakeWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((event?: { code?: number }) => void) | null = null

  constructor(url: string | URL) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED
  }

  emitOpen(): void {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  emitMessage(payload: unknown): void {
    this.onmessage?.({ data: typeof payload === "string" ? payload : JSON.stringify(payload) })
  }

  emitClose(event?: { code?: number }): void {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.(event)
  }
}

export class FakeEventSource {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2
  static instances: FakeEventSource[] = []

  url: string
  readyState = FakeEventSource.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED
  }

  emitOpen(): void {
    this.readyState = FakeEventSource.OPEN
    this.onopen?.()
  }

  emitMessage(data: unknown): void {
    this.onmessage?.({ data: typeof data === "string" ? data : JSON.stringify(data) })
  }

  emitError(): void {
    this.onerror?.()
  }
}

export function installFakeWebSocket(): void {
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    writable: true,
    value: FakeWebSocket,
  })
}

export function removeWebSocket(): void {
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    writable: true,
    value: undefined,
  })
}

export function installFakeEventSource(): void {
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    writable: true,
    value: FakeEventSource,
  })
}

export function setNavigatorOnline(onLine: boolean): void {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine },
  })
}

export function setVisibilityState(visibilityState: "visible" | "hidden"): void {
  Object.defineProperty(globalThis.document, "visibilityState", {
    configurable: true,
    value: visibilityState,
  })
}

export type SavedEnvironment = {
  WebSocket: typeof globalThis.WebSocket | undefined
  EventSource: typeof globalThis.EventSource | undefined
  navigator: typeof globalThis.navigator
  visibilityState: string
}

export function saveEnvironment(): SavedEnvironment {
  return {
    WebSocket: globalThis.WebSocket,
    EventSource: globalThis.EventSource,
    navigator: globalThis.navigator,
    visibilityState: globalThis.document?.visibilityState ?? "visible",
  }
}

export function restoreEnvironment(saved: SavedEnvironment): void {
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    writable: true,
    value: saved.WebSocket,
  })
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    writable: true,
    value: saved.EventSource,
  })
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: saved.navigator,
  })
  if (globalThis.document) {
    Object.defineProperty(globalThis.document, "visibilityState", {
      configurable: true,
      value: saved.visibilityState,
    })
  }
  FakeWebSocket.instances = []
  FakeEventSource.instances = []
}
