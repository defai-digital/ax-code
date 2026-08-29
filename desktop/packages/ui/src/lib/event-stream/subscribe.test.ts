import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { subscribeEventStream } from "./subscribe"
import type { EventStreamEnvelope } from "./subscribe"
import {
  FakeEventSource,
  installFakeEventSource,
  restoreEnvironment,
  saveEnvironment,
  type SavedEnvironment,
} from "./test-fakes"

const URL = "http://127.0.0.1/api/test-stream"

let saved: SavedEnvironment

beforeEach(() => {
  saved = saveEnvironment()
  installFakeEventSource()
})

afterEach(() => {
  vi.useRealTimers()
  restoreEnvironment(saved)
})

const flush = () => vi.advanceTimersByTimeAsync(0)

describe("subscribeEventStream — ref counting", () => {
  it("connects lazily on the first subscriber and closes on the last unsubscribe", () => {
    const first = subscribeEventStream({ url: URL, onEnvelope: () => {} })
    expect(FakeEventSource.instances).toHaveLength(1)

    const second = subscribeEventStream({ url: URL, onEnvelope: () => {} })
    expect(FakeEventSource.instances).toHaveLength(1) // shared

    first()
    expect(FakeEventSource.instances[0].readyState).not.toBe(FakeEventSource.CLOSED)

    second()
    expect(FakeEventSource.instances[0].readyState).toBe(FakeEventSource.CLOSED)

    // A fresh subscriber after teardown gets a fresh connection.
    const third = subscribeEventStream({ url: URL, onEnvelope: () => {} })
    expect(FakeEventSource.instances).toHaveLength(2)
    third()
  })
})

describe("subscribeEventStream — envelope filter", () => {
  it("drops unparseable frames and forwards valid envelopes", () => {
    const received: EventStreamEnvelope[] = []
    const unsubscribe = subscribeEventStream({ url: URL, onEnvelope: (env) => received.push(env) })

    const source = FakeEventSource.instances[0]
    source.emitOpen()
    source.emitMessage("not json at all")
    source.emitMessage(JSON.stringify({ noType: true }))
    source.emitMessage(JSON.stringify({ type: "openchamber:heartbeat" }))
    source.emitMessage(JSON.stringify({ type: "app:event", properties: { n: 1 } }))

    expect(received).toEqual([
      { type: "openchamber:heartbeat", properties: undefined },
      { type: "app:event", properties: { n: 1 } },
    ])
    unsubscribe()
  })

  it("consumes the event-stream-ready envelope as the onReady signal", () => {
    const received: EventStreamEnvelope[] = []
    let readyCount = 0
    const unsubscribe = subscribeEventStream({
      url: URL,
      onEnvelope: (env) => received.push(env),
      onReady: () => {
        readyCount += 1
      },
    })

    const source = FakeEventSource.instances[0]
    source.emitOpen()
    source.emitMessage(JSON.stringify({ type: "openchamber:event-stream-ready" }))
    source.emitMessage(JSON.stringify({ type: "app:event", properties: {} }))

    expect(readyCount).toBe(1)
    expect(received).toEqual([{ type: "app:event", properties: {} }])
    unsubscribe()
  })
})

describe("subscribeEventStream — ready resets the attempt counter", () => {
  it("drops the backoff back to base after a ready envelope", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)

    const connectAt: number[] = []
    const RecordingEventSource = class extends FakeEventSource {
      constructor(url: string) {
        super(url)
        connectAt.push(Date.now())
      }
    }
    Object.defineProperty(globalThis, "EventSource", {
      configurable: true,
      writable: true,
      value: RecordingEventSource,
    })

    const unsubscribe = subscribeEventStream({
      url: URL,
      backoff: { baseMs: 50, capVisibleMs: 400, capHiddenMs: 400, maxExponent: 8 },
      onEnvelope: () => {},
    })

    expect(connectAt).toHaveLength(1) // t=0

    FakeEventSource.instances[0].emitError()
    await vi.advanceTimersByTimeAsync(50) // failure 1 → 50ms
    expect(connectAt).toHaveLength(2)

    FakeEventSource.instances[1].emitError()
    await vi.advanceTimersByTimeAsync(100) // failure 2 → 100ms
    expect(connectAt).toHaveLength(3)

    // Successful connection: ready envelope resets the attempt counter.
    FakeEventSource.instances[2].emitOpen()
    FakeEventSource.instances[2].emitMessage(JSON.stringify({ type: "openchamber:event-stream-ready" }))
    await flush()
    FakeEventSource.instances[2].emitError()
    await vi.advanceTimersByTimeAsync(50) // back to base, not 200ms
    expect(connectAt).toHaveLength(4)

    expect(connectAt[1] - connectAt[0]).toBe(50)
    expect(connectAt[2] - connectAt[1]).toBe(100)
    expect(connectAt[3] - connectAt[2]).toBe(50)
    unsubscribe()
  })
})

describe("subscribeEventStream — environment guards", () => {
  it("is a no-op when EventSource is unavailable", () => {
    Object.defineProperty(globalThis, "EventSource", { configurable: true, writable: true, value: undefined })
    const unsubscribe = subscribeEventStream({ url: URL, onEnvelope: () => {} })
    expect(FakeEventSource.instances).toHaveLength(0)
    expect(() => unsubscribe()).not.toThrow()
  })
})
