import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { subscribeOpenchamberEvents, type ScheduledTaskRanEvent } from "../openchamberEvents"
import { API_ENDPOINTS } from "../http"
import {
  FakeEventSource,
  installFakeEventSource,
  restoreEnvironment,
  saveEnvironment,
  type SavedEnvironment,
} from "./test-fakes"

let saved: SavedEnvironment

beforeEach(() => {
  saved = saveEnvironment()
  installFakeEventSource()
})

afterEach(() => {
  vi.useRealTimers()
  restoreEnvironment(saved)
})

const emitEnvelope = (envelope: unknown, index = 0) => {
  FakeEventSource.instances[index].emitMessage(JSON.stringify(envelope))
}

describe("subscribeOpenchamberEvents", () => {
  it("connects to the openchamber events endpoint on subscribe", () => {
    const unsubscribe = subscribeOpenchamberEvents(() => {})
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.instances[0].url).toBe(API_ENDPOINTS.openchamber.events)
    unsubscribe()
  })

  it("dispatches scheduled-task-ran envelopes with normalization", () => {
    const received: ScheduledTaskRanEvent[] = []
    const unsubscribe = subscribeOpenchamberEvents((event) => received.push(event))

    FakeEventSource.instances[0].emitOpen()
    emitEnvelope({
      type: "openchamber:scheduled-task-ran",
      properties: { projectId: "p1", taskId: "t1", ranAt: 123, status: "error", sessionId: "s1" },
    })
    // Unknown status normalizes to "success"; missing ranAt falls back to now.
    emitEnvelope({
      type: "openchamber:scheduled-task-ran",
      properties: { projectId: "p2", taskId: "t2", status: "weird" },
    })

    expect(received).toHaveLength(2)
    expect(received[0]).toEqual({
      type: "scheduled-task-ran",
      projectId: "p1",
      taskId: "t1",
      ranAt: 123,
      status: "error",
      sessionId: "s1",
    })
    expect(received[1].status).toBe("success")
    expect(received[1].sessionId).toBeUndefined()
    expect(typeof received[1].ranAt).toBe("number")
    unsubscribe()
  })

  it("drops scheduled-task-ran envelopes without projectId or taskId", () => {
    const received: ScheduledTaskRanEvent[] = []
    const unsubscribe = subscribeOpenchamberEvents((event) => received.push(event))

    emitEnvelope({ type: "openchamber:scheduled-task-ran", properties: { taskId: "t1" } })
    emitEnvelope({ type: "openchamber:scheduled-task-ran", properties: { projectId: "p1" } })
    emitEnvelope({ type: "openchamber:scheduled-task-ran", properties: null })

    expect(received).toEqual([])
    unsubscribe()
  })

  it("ignores heartbeat and ready envelopes", () => {
    const received: ScheduledTaskRanEvent[] = []
    const unsubscribe = subscribeOpenchamberEvents((event) => received.push(event))

    FakeEventSource.instances[0].emitOpen()
    emitEnvelope({ type: "openchamber:event-stream-ready" })
    emitEnvelope({ type: "openchamber:heartbeat" })
    emitEnvelope({ type: "openchamber:something-else", properties: {} })

    expect(received).toEqual([])
    unsubscribe()
  })

  it("tears the stream down when the last listener unsubscribes", async () => {
    vi.useFakeTimers()
    const first = subscribeOpenchamberEvents(() => {})
    const second = subscribeOpenchamberEvents(() => {})
    expect(FakeEventSource.instances).toHaveLength(1)

    first()
    second()
    expect(FakeEventSource.instances[0].readyState).toBe(FakeEventSource.CLOSED)

    // No reconnect timers survive teardown.
    await vi.advanceTimersByTimeAsync(120_000)
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it("reconnects after 45s of silence (heartbeat watchdog)", async () => {
    vi.useFakeTimers()
    const unsubscribe = subscribeOpenchamberEvents(() => {})

    const first = FakeEventSource.instances[0]
    first.emitOpen()
    emitEnvelope({ type: "openchamber:event-stream-ready" })

    await vi.advanceTimersByTimeAsync(44_000)
    expect(FakeEventSource.instances).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(first.readyState).toBe(FakeEventSource.CLOSED)
    expect(FakeEventSource.instances).toHaveLength(2)
    unsubscribe()
  })

  it("stays connected while heartbeats keep arriving", async () => {
    vi.useFakeTimers()
    const unsubscribe = subscribeOpenchamberEvents(() => {})

    const first = FakeEventSource.instances[0]
    first.emitOpen()
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(30_000)
      emitEnvelope({ type: "openchamber:heartbeat" })
    }
    await vi.advanceTimersByTimeAsync(30_000)

    expect(FakeEventSource.instances).toHaveLength(1)
    unsubscribe()
  })
})
