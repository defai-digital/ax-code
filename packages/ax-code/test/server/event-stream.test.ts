import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { EventJournal } from "../../src/bus/event-journal"
import type { EventJournalEntry } from "../../src/bus/event-journal"
import { EventStream } from "../../src/server/event-stream"
import { parseJsonStrict } from "../../src/util/json-value"
import { Log } from "../../src/util/log"

type Value = { scope: string; value: number; terminal?: boolean }

function fixture(write?: (frame: EventStream.Frame) => Promise<void>) {
  const journal = new EventJournal<Value>({ epoch: "test" })
  const frames: EventStream.Frame[] = []
  const waiters: Array<{ count: number; resolve(): void }> = []
  let onAbort = () => {}
  let receive = (_entry: EventJournalEntry<Value>) => {}
  const unsubscribe = vi.fn()
  const subscribe = vi.fn((cursor: string | undefined, listener: typeof receive) => {
    receive = listener
    return { cursor: journal.cursor(), replay: cursor ? journal.replayAfter(cursor) : undefined, unsubscribe }
  })
  const writer: EventStream.Writer & { aborted: boolean } = {
    aborted: false,
    onAbort(listener) {
      onAbort = listener
    },
    async writeSSE(frame) {
      frames.push(frame)
      for (const waiter of waiters) if (frames.length >= waiter.count) waiter.resolve()
      await write?.(frame)
    },
  }
  return {
    journal,
    frames,
    writer,
    subscribe,
    unsubscribe,
    abort() {
      writer.aborted = true
      onAbort()
    },
    emit(value: Value) {
      receive(journal.append(value))
    },
    written(count: number) {
      return frames.length >= count
        ? Promise.resolve()
        : new Promise<void>((resolve) => waiters.push({ count, resolve }))
    },
    run(options: Partial<EventStream.Options<Value>> = {}) {
      return EventStream.run(writer, { label: "test", subscribe, ...options })
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("EventStream", () => {
  test("uses the same filter for replay and live events and acknowledges after replay", async () => {
    const f = fixture()
    f.journal.append({ scope: "other", value: 1 })
    const retained = f.journal.append({ scope: "mine", value: 2 })
    const running = f.run({ cursor: "test:0", filter: (value) => value.scope === "mine" })
    await f.written(2)
    f.emit({ scope: "other", value: 3 })
    f.emit({ scope: "mine", value: 4 })
    await f.written(3)
    f.abort()
    f.abort()
    await running
    expect(f.frames.map((frame) => frame.id)).toEqual(["test:2", "test:2", "test:4"])
    expect(f.frames[0].data).toBe(retained.data)
    expect(parseJsonStrict(f.frames[1].data)).toEqual({ type: "server.connected", properties: {} })
    expect(f.unsubscribe).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  test("projects data and control envelopes without changing journal IDs", async () => {
    const f = fixture()
    f.journal.append({ scope: "mine", value: 7 })
    const running = f.run({
      cursor: "test:0",
      project: (entry) => ({ data: String(entry.value.value), id: entry.id }),
      control: (payload) => ({ directory: "global", payload }),
    })
    await f.written(2)
    f.abort()
    await running
    expect(f.frames[0]).toEqual({ id: "test:1", data: "7" })
    expect(parseJsonStrict(f.frames[1].data)).toEqual({
      directory: "global",
      payload: { type: "server.connected", properties: {} },
    })
  })

  test.each([
    ["invalid", "invalid_cursor"],
    ["retired:0", "server_restarted"],
    ["test:999", "cursor_ahead"],
  ])("forwards the journal gap for %s before acknowledgement", async (cursor, reason) => {
    const f = fixture()
    const running = f.run({ cursor })
    await f.written(2)
    f.abort()
    await running
    expect(parseJsonStrict(f.frames[0].data)).toEqual({
      type: "server.resync_required",
      properties: { reason, cursor: "test:0" },
    })
    expect(f.frames.map((frame) => frame.id)).toEqual(["test:0", "test:0"])
  })

  test("resyncs when replay fills the reserved acknowledgement capacity", async () => {
    const f = fixture()
    for (let i = 0; i < 3; i++) f.journal.append({ scope: "mine", value: i })
    const running = f.run({ cursor: "test:0", maxQueueSize: 4 })
    await f.written(2)
    f.abort()
    await running
    expect(parseJsonStrict(f.frames[0].data)).toEqual({
      type: "server.resync_required",
      properties: { reason: "buffer_overflow", cursor: "test:3" },
    })
    expect(parseJsonStrict(f.frames[1].data)).toEqual({ type: "server.connected", properties: {} })
  })

  test("disconnects on live overflow, drains admitted frames, and ignores late callbacks", async () => {
    const gate = Promise.withResolvers<void>()
    const f = fixture(() => gate.promise)
    const running = f.run({ maxQueueSize: 3 })
    await f.written(1)
    for (let i = 0; i < 5; i++) f.emit({ scope: "mine", value: i })
    expect(f.unsubscribe).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    gate.resolve()
    await running
    expect(f.frames.map((frame) => frame.id)).toEqual(["test:0", "test:1", "test:2", "test:3"])
  })

  test("bounds heartbeats without disconnecting and leaves capacity for real events", async () => {
    const gate = Promise.withResolvers<void>()
    const f = fixture(() => gate.promise)
    const running = f.run({ maxQueueSize: 3, heartbeatQueueLimit: 2 })
    await f.written(1)
    vi.advanceTimersByTime(40_000)
    f.emit({ scope: "mine", value: 1 })
    expect(f.unsubscribe).not.toHaveBeenCalled()
    gate.resolve()
    await f.written(4)
    f.abort()
    await running
    expect(f.frames.map((frame) => frame.id)).toEqual(["test:0", undefined, undefined, "test:1"])
    expect(f.frames.slice(1, 3).map((frame) => parseJsonStrict(frame.data))).toEqual([
      { type: "server.heartbeat", properties: {} },
      { type: "server.heartbeat", properties: {} },
    ])
    expect(vi.getTimerCount()).toBe(0)
  })

  test("stops writing queued frames after abort", async () => {
    const gate = Promise.withResolvers<void>()
    const f = fixture(() => gate.promise)
    const running = f.run()
    await f.written(1)
    f.emit({ scope: "mine", value: 1 })
    f.abort()
    gate.resolve()
    await running
    expect(f.frames).toHaveLength(1)
    expect(f.unsubscribe).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  test("does not subscribe when the writer has already aborted", async () => {
    const f = fixture()
    f.abort()
    await f.run()
    expect(f.subscribe).not.toHaveBeenCalled()
    expect(f.frames).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  test("cleans up a terminal event delivered synchronously during subscription", async () => {
    const f = fixture()
    const entry = f.journal.append({ scope: "mine", value: 1, terminal: true })
    await f.run({
      subscribe: (_cursor, listener) => {
        listener(entry)
        return { cursor: entry.id, unsubscribe: f.unsubscribe }
      },
      terminate: (value) => value.terminal ?? false,
    })
    expect(f.frames).toEqual([{ data: entry.data, id: entry.id }])
    expect(f.unsubscribe).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  test("cleans up when an abort occurs before subscribe returns its cleanup handle", async () => {
    const f = fixture()
    await f.run({
      subscribe: () => {
        f.abort()
        return { cursor: "test:0", unsubscribe: f.unsubscribe }
      },
    })
    expect(f.frames).toEqual([])
    expect(f.unsubscribe).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  test("propagates setup failure without starting a heartbeat", async () => {
    const f = fixture()
    await expect(
      f.run({
        subscribe: () => {
          throw new Error("setup failed")
        },
      }),
    ).rejects.toThrow("setup failed")
    expect(vi.getTimerCount()).toBe(0)
  })

  test("cleans up subscriptions when replay projection fails", async () => {
    const f = fixture()
    f.journal.append({ scope: "mine", value: 1 })
    await expect(
      f.run({
        cursor: "test:0",
        project: () => {
          throw new Error("projection failed")
        },
      }),
    ).rejects.toThrow("projection failed")
    expect(f.unsubscribe).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  test("cleans up and propagates writer failure", async () => {
    const f = fixture(async () => {
      throw new Error("write failed")
    })
    await expect(f.run()).rejects.toThrow("write failed")
    expect(f.unsubscribe).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  test("warns only once under backpressure and still delivers every admitted event", async () => {
    const gate = Promise.withResolvers<void>()
    const f = fixture(() => gate.promise)
    const warn = vi.spyOn(Log.create({ service: "server.event-stream" }), "warn")
    const running = f.run({ maxQueueSize: 4, warnThreshold: 2, terminate: (value) => value.terminal ?? false })
    await f.written(1)
    f.emit({ scope: "mine", value: 1 })
    f.emit({ scope: "mine", value: 2 })
    f.emit({ scope: "mine", value: 3, terminal: true })
    gate.resolve()
    await running
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith("SSE queue approaching capacity", {
      stream: "test",
      queueSize: 2,
      warnThreshold: 2,
      hardMax: 4,
    })
    expect(f.frames.map((frame) => frame.id)).toEqual(["test:0", "test:1", "test:2", "test:3"])
    expect(f.unsubscribe).toHaveBeenCalledTimes(1)
  })

  test("reports heartbeat projection failure and keeps live delivery working", async () => {
    const f = fixture()
    const error = new Error("heartbeat failed")
    const warn = vi.spyOn(Log.create({ service: "server.event-stream" }), "warn")
    const running = f.run({
      control: (event) => {
        if (event.type === "server.heartbeat") throw error
        return event
      },
    })
    await f.written(1)
    vi.advanceTimersByTime(10_000)
    f.emit({ scope: "mine", value: 1 })
    await f.written(2)
    f.abort()
    await running
    expect(warn).toHaveBeenCalledWith("event heartbeat failed", { stream: "test", error })
    expect(f.frames.map((frame) => frame.id)).toEqual(["test:0", "test:1"])
    expect(vi.getTimerCount()).toBe(0)
  })

  test("reports unsubscribe errors while still closing the queue and timer", async () => {
    const f = fixture()
    const error = new Error("unsubscribe failed")
    f.unsubscribe.mockImplementation(() => {
      throw error
    })
    const warn = vi.spyOn(Log.create({ service: "server.event-stream" }), "warn")
    const running = f.run()
    await f.written(1)
    f.abort()
    await running
    expect(warn).toHaveBeenCalledWith("event unsubscribe failed", { stream: "test", error })
    expect(vi.getTimerCount()).toBe(0)
  })
})
