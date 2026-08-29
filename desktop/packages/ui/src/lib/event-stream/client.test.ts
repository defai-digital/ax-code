import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createEventTransport } from "./client"
import type { SdkSseDriver, TransportError, TransportState, WsDriver } from "./types"
import { SYNC_RETRY_NOW_EVENT, SYSTEM_RESUME_EVENT } from "./visibility"
import {
  FakeWebSocket,
  installFakeWebSocket,
  restoreEnvironment,
  saveEnvironment,
  setNavigatorOnline,
  setVisibilityState,
  type SavedEnvironment,
} from "./test-fakes"

const BACKOFF = { baseMs: 20, capVisibleMs: 100, capHiddenMs: 400, maxExponent: 8 }

let saved: SavedEnvironment
let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  saved = saveEnvironment()
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  restoreEnvironment(saved)
  consoleErrorSpy.mockRestore()
})

const noopHooks = {
  onFrame: () => {},
  onConnected: () => {},
}

const failingSseDriver = (calls: number[], error: () => unknown = () => new Error("boom")): SdkSseDriver => ({
  kind: "sse-sdk",
  open: async () => {
    calls.push(Date.now())
    throw error()
  },
})

const deltas = (timestamps: number[]): number[] => timestamps.slice(1).map((t, i) => t - timestamps[i])

describe("createEventTransport — state machine", () => {
  it("transitions idle → connecting → open on WS ready and closes on close()", () => {
    installFakeWebSocket()
    const states: TransportState[] = []
    const connected: Array<{ first: boolean; transport: string }> = []
    const driver: WsDriver = { kind: "ws", url: () => "ws://127.0.0.1/api/global/event/ws" }

    const transport = createEventTransport(
      { drivers: { primary: driver }, transport: "ws", backoff: BACKOFF },
      {
        ...noopHooks,
        onConnected: (info) => connected.push(info),
        onStateChange: (s) => states.push(s),
      },
    )

    expect(transport.state()).toBe("connecting")
    const socket = FakeWebSocket.instances[0]
    expect(socket).toBeDefined()

    socket.emitOpen()
    socket.emitMessage({ type: "ready", scope: "global" })

    expect(connected).toEqual([{ first: true, transport: "ws" }])
    expect(transport.state()).toBe("open")

    transport.close()
    expect(transport.state()).toBe("closed")
    expect(states).toEqual(["connecting", "open", "closed"])
  })

  it("delivers WS event frames with their event id", () => {
    installFakeWebSocket()
    const frames: Array<{ frame: unknown; meta: { transport: string; eventId?: string } }> = []
    const driver: WsDriver = { kind: "ws", url: () => "ws://127.0.0.1/api/global/event/ws" }

    const transport = createEventTransport(
      { drivers: { primary: driver }, transport: "ws", backoff: BACKOFF },
      {
        onFrame: (frame, meta) => frames.push({ frame, meta }),
        onConnected: () => {},
      },
    )

    const socket = FakeWebSocket.instances[0]
    socket.emitOpen()
    socket.emitMessage({ type: "ready" })
    socket.emitMessage({ type: "event", eventId: "evt-9", directory: "/repo", payload: { type: "x" } })

    expect(frames).toHaveLength(1)
    expect(frames[0].meta).toEqual({ transport: "ws", eventId: "evt-9" })
    expect((frames[0].frame as { payload: { type: string } }).payload.type).toBe("x")
    transport.close()
  })
})

describe("createEventTransport — backoff schedules", () => {
  it("follows the visible profile: base, doubling, then the visible cap", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    setNavigatorOnline(true)
    setVisibilityState("visible")

    const calls: number[] = []
    const transport = createEventTransport(
      { drivers: { primary: failingSseDriver(calls) }, transport: "sse", backoff: BACKOFF },
      noopHooks,
    )

    expect(calls).toHaveLength(1) // first attempt fires immediately
    await vi.advanceTimersByTimeAsync(20)
    await vi.advanceTimersByTimeAsync(40)
    await vi.advanceTimersByTimeAsync(80)
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(100)

    expect(calls).toHaveLength(6)
    expect(deltas(calls)).toEqual([20, 40, 80, 100, 100])
    transport.close()
  })

  it("uses the hidden cap when the tab is hidden", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    setNavigatorOnline(true)
    setVisibilityState("hidden")

    const calls: number[] = []
    const transport = createEventTransport(
      {
        drivers: { primary: failingSseDriver(calls) },
        transport: "sse",
        backoff: { baseMs: 20, capVisibleMs: 100, capHiddenMs: 250, maxExponent: 8 },
      },
      noopHooks,
    )

    await vi.advanceTimersByTimeAsync(20)
    await vi.advanceTimersByTimeAsync(40)
    await vi.advanceTimersByTimeAsync(80)
    await vi.advanceTimersByTimeAsync(160)
    await vi.advanceTimersByTimeAsync(250)

    expect(calls).toHaveLength(6)
    expect(deltas(calls)).toEqual([20, 40, 80, 160, 250])
    transport.close()
  })

  it("uses the long cap immediately while offline", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    setNavigatorOnline(false)
    setVisibilityState("visible")

    const calls: number[] = []
    const transport = createEventTransport(
      { drivers: { primary: failingSseDriver(calls) }, transport: "sse", backoff: BACKOFF },
      noopHooks,
    )

    await vi.advanceTimersByTimeAsync(400)
    await vi.advanceTimersByTimeAsync(400)

    expect(calls).toHaveLength(3)
    expect(deltas(calls)).toEqual([400, 400])
    transport.close()
  })

  it("uses the long cap immediately for permanent 4xx errors", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    setNavigatorOnline(true)
    setVisibilityState("visible")

    const calls: number[] = []
    const transport = createEventTransport(
      {
        drivers: { primary: failingSseDriver(calls, () => Object.assign(new Error("Not Found"), { status: 404 })) },
        transport: "sse",
        backoff: BACKOFF,
      },
      noopHooks,
    )

    // Nothing within the visible cap window — the long cap (400ms) applies.
    await vi.advanceTimersByTimeAsync(100)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(300)
    await vi.advanceTimersByTimeAsync(400)

    expect(calls).toHaveLength(3)
    expect(deltas(calls)).toEqual([400, 400])
    transport.close()
  })

  it("keeps 408/429 on the normal exponential path", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    setNavigatorOnline(true)
    setVisibilityState("visible")

    const calls: number[] = []
    const transport = createEventTransport(
      {
        drivers: { primary: failingSseDriver(calls, () => Object.assign(new Error("Rate limited"), { status: 429 })) },
        transport: "sse",
        backoff: BACKOFF,
      },
      noopHooks,
    )

    await vi.advanceTimersByTimeAsync(20)
    await vi.advanceTimersByTimeAsync(40)

    expect(calls).toHaveLength(3)
    expect(deltas(calls)).toEqual([20, 40])
    transport.close()
  })
})

describe("createEventTransport — backoff interrupts", () => {
  it.each([
    ["online", () => window.dispatchEvent(new Event("online"))],
    [SYSTEM_RESUME_EVENT, () => window.dispatchEvent(new Event(SYSTEM_RESUME_EVENT))],
    [SYNC_RETRY_NOW_EVENT, () => window.dispatchEvent(new Event(SYNC_RETRY_NOW_EVENT))],
    ["pageshow (persisted)", () => window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }))],
    [
      "visibilitychange",
      () => {
        setVisibilityState("visible")
        document.dispatchEvent(new Event("visibilitychange"))
      },
    ],
  ])("cuts the inter-attempt wait short on %s", async (_name, fire) => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    setNavigatorOnline(true)
    setVisibilityState("hidden") // long cap in effect so only the interrupt can wake the wait

    const calls: number[] = []
    const transport = createEventTransport(
      { drivers: { primary: failingSseDriver(calls) }, transport: "sse", backoff: BACKOFF },
      noopHooks,
    )

    expect(calls).toHaveLength(1)
    // Let the failure land and the inter-attempt wait begin before firing.
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(1)
    fire()
    await vi.advanceTimersByTimeAsync(0)

    expect(calls).toHaveLength(2)
    transport.close()
  })

  it("ignores a non-persisted pageshow (plain navigation, not bfcache restore)", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    setNavigatorOnline(true)
    setVisibilityState("visible")

    const calls: number[] = []
    const transport = createEventTransport(
      { drivers: { primary: failingSseDriver(calls) }, transport: "sse", backoff: BACKOFF },
      noopHooks,
    )

    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(1) // waiting out the 20ms base delay
    window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: false }))
    await vi.advanceTimersByTimeAsync(10)
    expect(calls).toHaveLength(1) // not interrupted
    await vi.advanceTimersByTimeAsync(15)
    expect(calls).toHaveLength(2) // plain timer fired instead
    transport.close()
  })
})

describe("createEventTransport — heartbeat", () => {
  it("aborts the attempt after the configured silence and reports heartbeat_timeout", async () => {
    vi.useFakeTimers()
    installFakeWebSocket()
    setNavigatorOnline(true)
    setVisibilityState("visible")

    const errors: TransportError[] = []
    const connected: Array<{ first: boolean }> = []
    const driver: WsDriver = { kind: "ws", url: () => "ws://127.0.0.1/api/global/event/ws" }
    const transport = createEventTransport(
      { drivers: { primary: driver }, transport: "ws", heartbeatTimeoutMs: 30, backoff: BACKOFF },
      {
        ...noopHooks,
        onConnected: (info) => connected.push(info),
        onDisconnected: (err) => errors.push(err),
      },
    )

    const first = FakeWebSocket.instances[0]
    first.emitOpen()
    first.emitMessage({ type: "ready" })

    await vi.advanceTimersByTimeAsync(30)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ code: "heartbeat_timeout", transport: "ws", message: "heartbeat_timeout" })
    // delay 0 after a heartbeat abort — the next attempt fires immediately.
    expect(FakeWebSocket.instances).toHaveLength(2)

    FakeWebSocket.instances[1].emitOpen()
    FakeWebSocket.instances[1].emitMessage({ type: "ready" })
    expect(connected).toEqual([
      { first: true, transport: "ws" },
      { first: false, transport: "ws" },
    ])
    transport.close()
  })

  it("never times out when heartbeatTimeoutMs is undefined", async () => {
    vi.useFakeTimers()
    installFakeWebSocket()

    const errors: TransportError[] = []
    const driver: WsDriver = { kind: "ws", url: () => "ws://127.0.0.1/api/global/event/ws" }
    const transport = createEventTransport(
      { drivers: { primary: driver }, transport: "ws", backoff: BACKOFF },
      { ...noopHooks, onDisconnected: (err) => errors.push(err) },
    )

    const socket = FakeWebSocket.instances[0]
    socket.emitOpen()
    socket.emitMessage({ type: "ready" })

    await vi.advanceTimersByTimeAsync(120_000)

    expect(errors).toEqual([])
    expect(FakeWebSocket.instances).toHaveLength(1)
    transport.close()
  })
})

describe("createEventTransport — WS → SSE fallback", () => {
  const wsDriver: WsDriver = { kind: "ws", url: () => "ws://127.0.0.1/api/global/event/ws" }

  const recordingSseDriver = (calls: Array<{ headers?: Record<string, string> }>): SdkSseDriver => ({
    kind: "sse-sdk",
    open: async (opts) => {
      calls.push({ ...(opts.headers ? { headers: opts.headers } : {}) })
      return {
        stream: (async function* () {
          await new Promise(() => {})
          yield undefined
        })(),
      }
    },
  })

  it("falls back after a WS ready timeout with onTransportSwitch (not onDisconnected)", async () => {
    vi.useFakeTimers()
    installFakeWebSocket()
    setNavigatorOnline(true)
    setVisibilityState("visible")

    const sseCalls: Array<{ headers?: Record<string, string> }> = []
    const switches: number[] = []
    const errors: TransportError[] = []
    const transport = createEventTransport(
      {
        drivers: { primary: wsDriver, fallback: recordingSseDriver(sseCalls) },
        transport: "auto",
        wsReadyTimeoutMs: 20,
        backoff: BACKOFF,
      },
      {
        ...noopHooks,
        onTransportSwitch: () => switches.push(Date.now()),
        onDisconnected: (err) => errors.push(err),
      },
    )

    FakeWebSocket.instances[0].emitOpen()
    await vi.advanceTimersByTimeAsync(20)

    expect(switches).toHaveLength(1)
    expect(errors).toEqual([])
    // delay 0 on switch — the SSE attempt fires immediately.
    expect(sseCalls).toHaveLength(1)
    transport.close()
  })

  it("falls back when the socket closes before ready", async () => {
    vi.useFakeTimers()
    installFakeWebSocket()
    setNavigatorOnline(true)
    setVisibilityState("visible")

    const sseCalls: Array<{ headers?: Record<string, string> }> = []
    const switches: number[] = []
    const transport = createEventTransport(
      {
        drivers: { primary: wsDriver, fallback: recordingSseDriver(sseCalls) },
        transport: "auto",
        backoff: BACKOFF,
      },
      { ...noopHooks, onTransportSwitch: () => switches.push(1) },
    )

    FakeWebSocket.instances[0].emitClose({ code: 1006 })
    await vi.advanceTimersByTimeAsync(0)

    expect(switches).toHaveLength(1)
    expect(sseCalls).toHaveLength(1)
    transport.close()
  })

  it("falls back when a ready connection drops inside the unstable-ready window", async () => {
    vi.useFakeTimers()
    installFakeWebSocket()
    setNavigatorOnline(true)
    setVisibilityState("visible")

    const sseCalls: Array<{ headers?: Record<string, string> }> = []
    const switches: number[] = []
    const transport = createEventTransport(
      {
        drivers: { primary: wsDriver, fallback: recordingSseDriver(sseCalls) },
        transport: "auto",
        unstableReadyWindowMs: 2_000,
        backoff: BACKOFF,
      },
      { ...noopHooks, onTransportSwitch: () => switches.push(1) },
    )

    const socket = FakeWebSocket.instances[0]
    socket.emitOpen()
    socket.emitMessage({ type: "ready" })
    await vi.advanceTimersByTimeAsync(10) // lived < 2s unstable window
    socket.emitClose({ code: 1006 })
    await vi.advanceTimersByTimeAsync(0)

    expect(switches).toHaveLength(1)
    expect(sseCalls).toHaveLength(1)
    transport.close()
  })

  it("falls back when a ready connection closes in the same millisecond (0ms lived)", async () => {
    vi.useFakeTimers()
    installFakeWebSocket()
    setNavigatorOnline(true)
    setVisibilityState("visible")

    const sseCalls: Array<{ headers?: Record<string, string> }> = []
    const switches: number[] = []
    const transport = createEventTransport(
      {
        drivers: { primary: wsDriver, fallback: recordingSseDriver(sseCalls) },
        transport: "auto",
        unstableReadyWindowMs: 2_000,
        backoff: BACKOFF,
      },
      { ...noopHooks, onTransportSwitch: () => switches.push(1) },
    )

    const socket = FakeWebSocket.instances[0]
    // open → ready → close in a single tick: a proxy/LB cutting the socket
    // right after the handshake must still be fallback-eligible.
    socket.emitOpen()
    socket.emitMessage({ type: "ready" })
    socket.emitClose({ code: 1006 })
    await vi.advanceTimersByTimeAsync(0)

    expect(switches).toHaveLength(1)
    expect(sseCalls).toHaveLength(1)
    transport.close()
  })

  it("does not fall back when a stable ready connection closes", async () => {
    vi.useFakeTimers()
    installFakeWebSocket()
    setNavigatorOnline(true)
    setVisibilityState("visible")

    const sseCalls: Array<{ headers?: Record<string, string> }> = []
    const switches: number[] = []
    const errors: TransportError[] = []
    const transport = createEventTransport(
      {
        drivers: { primary: wsDriver, fallback: recordingSseDriver(sseCalls) },
        transport: "auto",
        unstableReadyWindowMs: 2_000,
        backoff: BACKOFF,
      },
      {
        ...noopHooks,
        onTransportSwitch: () => switches.push(1),
        onDisconnected: (err) => errors.push(err),
      },
    )

    const socket = FakeWebSocket.instances[0]
    socket.emitOpen()
    socket.emitMessage({ type: "ready" })
    await vi.advanceTimersByTimeAsync(3_000) // lived past the unstable window
    socket.emitClose({ code: 1006 })
    await vi.advanceTimersByTimeAsync(20) // normal backoff base

    expect(switches).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ code: "ws_closed", transport: "ws", closeCode: 1006 })
    expect(sseCalls).toEqual([])
    expect(FakeWebSocket.instances).toHaveLength(2) // retried on WS
    transport.close()
  })
})

describe("createEventTransport — cursor plumbing", () => {
  it("feeds the WS event id into the next attempt's url cursor", async () => {
    installFakeWebSocket()
    const driver: WsDriver = {
      kind: "ws",
      url: (cursor) => `ws://127.0.0.1/api/global/event/ws${cursor ? `?lastEventId=${cursor}` : ""}`,
    }
    const transport = createEventTransport(
      { drivers: { primary: driver }, transport: "ws", backoff: BACKOFF },
      noopHooks,
    )

    const first = FakeWebSocket.instances[0]
    expect(String(first.url)).not.toContain("lastEventId")
    first.emitOpen()
    first.emitMessage({ type: "ready" })
    first.emitMessage({ type: "event", eventId: "42", payload: { type: "x" } })

    transport.reconnect("test")
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(String(FakeWebSocket.instances[1].url)).toContain("lastEventId=42")
    transport.close()
  })

  it("feeds the SDK SSE event id into the next attempt's Last-Event-ID header", async () => {
    vi.useFakeTimers()
    const opens: Array<{ headers?: Record<string, string> }> = []
    const driver: SdkSseDriver = {
      kind: "sse-sdk",
      open: async (opts) => {
        opens.push({ ...(opts.headers ? { headers: opts.headers } : {}) })
        opts.onSseEvent({ id: "7" })
        return {
          stream: (async function* () {
            yield { payload: { type: "server.connected" } }
          })(),
        }
      },
    }
    const transport = createEventTransport(
      { drivers: { primary: driver }, transport: "sse", backoff: BACKOFF },
      noopHooks,
    )

    // First attempt completes cleanly (stream ended) → re-loop on the base delay.
    await vi.advanceTimersByTimeAsync(20)

    expect(opens).toHaveLength(2)
    expect(opens[0].headers).toBeUndefined()
    expect(opens[1].headers).toEqual({ "Last-Event-ID": "7" })
    transport.close()
  })

  it("reports numeric cursor jumps through the opt-in onGap hook", async () => {
    vi.useFakeTimers()
    const gaps: Array<[string, string]> = []
    const driver: SdkSseDriver = {
      kind: "sse-sdk",
      open: async (opts) => {
        opts.onSseEvent({ id: "1" })
        opts.onSseEvent({ id: "5" })
        return {
          stream: (async function* () {
            await new Promise(() => {})
            yield undefined
          })(),
        }
      },
    }
    const transport = createEventTransport(
      { drivers: { primary: driver }, transport: "sse", backoff: BACKOFF },
      { ...noopHooks, onGap: (prev, next) => gaps.push([prev, next]) },
    )

    await vi.advanceTimersByTimeAsync(0)
    expect(gaps).toEqual([["1", "5"]])
    transport.close()
  })
})

describe("createEventTransport — lifecycle interrupts", () => {
  it("aborts a stale visible attempt (no activity within the heartbeat window)", async () => {
    vi.useFakeTimers()
    installFakeWebSocket()
    setNavigatorOnline(true)
    setVisibilityState("visible")

    const driver: WsDriver = { kind: "ws", url: () => "ws://127.0.0.1/api/global/event/ws" }
    const transport = createEventTransport(
      { drivers: { primary: driver }, transport: "ws", heartbeatTimeoutMs: 100, backoff: BACKOFF },
      noopHooks,
    )

    const first = FakeWebSocket.instances[0]
    first.emitOpen()
    first.emitMessage({ type: "ready" })

    // The heartbeat timer itself is what aborts stale attempts; disable it by
    // racing the visibility check just ahead of the heartbeat fire time: last
    // activity is at t=0, so at t>=100 a visible tab aborts the attempt.
    await vi.advanceTimersByTimeAsync(100)
    // The heartbeat already fired at t=100 and aborted the attempt (same
    // mechanism the visibility-stale check uses) — a new attempt is up.
    expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(2)
    transport.close()
  })

  it("reconnect() reports manual_retry with the given reason", async () => {
    installFakeWebSocket()
    setNavigatorOnline(true)
    setVisibilityState("visible")

    const errors: TransportError[] = []
    const driver: WsDriver = { kind: "ws", url: () => "ws://127.0.0.1/api/global/event/ws" }
    const transport = createEventTransport(
      { drivers: { primary: driver }, transport: "ws", backoff: BACKOFF },
      { ...noopHooks, onDisconnected: (err) => errors.push(err) },
    )

    const first = FakeWebSocket.instances[0]
    first.emitOpen()
    first.emitMessage({ type: "ready" })

    transport.reconnect()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ code: "manual_retry", transport: "ws", message: "manual" })
    expect(FakeWebSocket.instances).toHaveLength(2)
    transport.close()
  })

  it("labels raw WS driver errors with a ws code (never sse_error)", async () => {
    installFakeWebSocket()
    const errors: TransportError[] = []
    const driver: WsDriver = {
      kind: "ws",
      url: () => {
        throw new Error("bad ws url")
      },
    }
    const transport = createEventTransport(
      { drivers: { primary: driver }, transport: "ws", backoff: BACKOFF },
      { ...noopHooks, onDisconnected: (err) => errors.push(err) },
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ code: "ws_closed", transport: "ws", message: "bad ws url" })
    transport.close()
  })
})

describe("createEventTransport — no WebSocket available", () => {
  it("uses the SSE fallback driver when WebSocket is not a function", async () => {
    Object.defineProperty(globalThis, "WebSocket", { configurable: true, writable: true, value: undefined })
    const opens: number[] = []
    const sseDriver: SdkSseDriver = {
      kind: "sse-sdk",
      open: async () => {
        opens.push(1)
        return {
          stream: (async function* () {
            await new Promise(() => {})
            yield undefined
          })(),
        }
      },
    }
    const wsDriver: WsDriver = { kind: "ws", url: () => "ws://127.0.0.1/api/global/event/ws" }
    const transport = createEventTransport(
      { drivers: { primary: wsDriver, fallback: sseDriver }, transport: "auto", backoff: BACKOFF },
      noopHooks,
    )

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(opens).toHaveLength(1)
    transport.close()
  })
})
