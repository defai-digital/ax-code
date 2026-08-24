import { describe, expect, test } from "vitest"
import { coalesceStreamEvents, createStreamDeltaCoalescer } from "../../../src/cli/cmd/tui/util/coalesce-stream-events"

describe("coalesceStreamEvents", () => {
  test("merges text deltas for the same part", () => {
    const merged = coalesceStreamEvents([
      {
        type: "message.part.delta",
        properties: { sessionID: "s1", messageID: "m1", partID: "p1", field: "text", delta: "Hel" },
      },
      {
        type: "message.part.delta",
        properties: { sessionID: "s1", messageID: "m1", partID: "p1", field: "text", delta: "lo" },
      },
      {
        type: "message.part.delta",
        properties: { sessionID: "s1", messageID: "m1", partID: "p1", field: "text", delta: "!" },
      },
    ])

    expect(merged).toEqual([
      {
        type: "message.part.delta",
        properties: { sessionID: "s1", messageID: "m1", partID: "p1", field: "text", delta: "Hello!" },
      },
    ])
  })

  test("keeps deltas for different parts separate", () => {
    const merged = coalesceStreamEvents([
      {
        type: "message.part.delta",
        properties: { messageID: "m1", partID: "p1", field: "text", delta: "a" },
      },
      {
        type: "message.part.delta",
        properties: { messageID: "m1", partID: "p2", field: "text", delta: "b" },
      },
    ])

    expect(merged).toHaveLength(2)
    expect(merged[0]?.properties?.delta).toBe("a")
    expect(merged[1]?.properties?.delta).toBe("b")
  })

  test("flushes pending deltas before a non-delta event", () => {
    const merged = coalesceStreamEvents([
      {
        type: "message.part.delta",
        properties: { messageID: "m1", partID: "p1", field: "text", delta: "a" },
      },
      {
        type: "message.updated",
        properties: { info: { id: "m1" } },
      },
      {
        type: "message.part.delta",
        properties: { messageID: "m1", partID: "p1", field: "text", delta: "b" },
      },
      {
        type: "message.part.delta",
        properties: { messageID: "m1", partID: "p1", field: "text", delta: "c" },
      },
    ])

    expect(merged).toEqual([
      {
        type: "message.part.delta",
        properties: { messageID: "m1", partID: "p1", field: "text", delta: "a" },
      },
      {
        type: "message.updated",
        properties: { info: { id: "m1" } },
      },
      {
        type: "message.part.delta",
        properties: { messageID: "m1", partID: "p1", field: "text", delta: "bc" },
      },
    ])
  })

  test("leaves non-text deltas alone", () => {
    const events = [
      {
        type: "message.part.delta",
        properties: { messageID: "m1", partID: "p1", field: "reasoning", delta: "x" },
      },
      {
        type: "message.part.delta",
        properties: { messageID: "m1", partID: "p1", field: "reasoning", delta: "y" },
      },
    ]
    expect(coalesceStreamEvents(events)).toEqual(events)
  })

  test("merges contiguous offset deltas and keeps the first chunk's offset", () => {
    const merged = coalesceStreamEvents([
      {
        type: "message.part.delta",
        properties: { messageID: "m1", partID: "p1", field: "text", delta: "Hel", offset: 0 },
      },
      {
        type: "message.part.delta",
        properties: { messageID: "m1", partID: "p1", field: "text", delta: "lo", offset: 3 },
      },
    ])

    expect(merged).toEqual([
      {
        type: "message.part.delta",
        properties: { messageID: "m1", partID: "p1", field: "text", delta: "Hello", offset: 0 },
      },
    ])
  })

  test("trims the overlap when merging offset deltas instead of duplicating it", () => {
    const merged = coalesceStreamEvents([
      {
        type: "message.part.delta",
        properties: { messageID: "m1", partID: "p1", field: "text", delta: "hello", offset: 0 },
      },
      {
        type: "message.part.delta",
        properties: { messageID: "m1", partID: "p1", field: "text", delta: "lo world", offset: 3 },
      },
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0]?.properties?.delta).toBe("hello world")
    expect(merged[0]?.properties?.offset).toBe(0)
  })

  test("keeps non-contiguous offset deltas separate so the gap stays visible", () => {
    const merged = coalesceStreamEvents([
      {
        type: "message.part.delta",
        properties: { messageID: "m1", partID: "p1", field: "text", delta: "ab", offset: 0 },
      },
      {
        type: "message.part.delta",
        properties: { messageID: "m1", partID: "p1", field: "text", delta: "cd", offset: 5 },
      },
    ])

    expect(merged).toHaveLength(2)
    expect(merged[0]?.properties?.delta).toBe("ab")
    expect(merged[1]?.properties?.delta).toBe("cd")
  })

  test("keeps a backwards-jump delta separate instead of dropping its text", () => {
    const merged = coalesceStreamEvents([
      {
        type: "message.part.delta",
        properties: { messageID: "m1", partID: "p1", field: "text", delta: "abc", offset: 5 },
      },
      {
        type: "message.part.delta",
        properties: { messageID: "m1", partID: "p1", field: "text", delta: "hello", offset: 0 },
      },
    ])

    expect(merged).toHaveLength(2)
    expect(merged[0]?.properties?.delta).toBe("abc")
    expect(merged[1]?.properties?.delta).toBe("hello")
  })

  test("keeps a mixed-offset delta separate instead of duplicating text", () => {
    const merged = coalesceStreamEvents([
      {
        type: "message.part.delta",
        properties: { messageID: "m1", partID: "p1", field: "text", delta: "abc", offset: 0 },
      },
      {
        type: "message.part.delta",
        properties: { messageID: "m1", partID: "p1", field: "text", delta: "abc" },
      },
    ])

    expect(merged).toHaveLength(2)
    expect(merged[0]?.properties?.delta).toBe("abc")
    expect(merged[1]?.properties?.delta).toBe("abc")
  })
})

describe("createStreamDeltaCoalescer", () => {
  test("buffers text deltas until the window and merges them", () => {
    const emitted: unknown[][] = []
    const timers: Array<{ fn: () => void; delay: number }> = []
    let now = 0

    const coalescer = createStreamDeltaCoalescer({
      windowMs: 16,
      now: () => now,
      schedule: (fn, delayMs) => {
        timers.push({ fn, delay: delayMs })
        return () => {
          const index = timers.findIndex((timer) => timer.fn === fn)
          if (index >= 0) timers.splice(index, 1)
        }
      },
      emit: (events) => {
        emitted.push(events)
      },
    })

    coalescer.push({
      type: "message.part.delta",
      properties: { messageID: "m1", partID: "p1", field: "text", delta: "Hel" },
    })
    coalescer.push({
      type: "message.part.delta",
      properties: { messageID: "m1", partID: "p1", field: "text", delta: "lo" },
    })
    expect(emitted).toEqual([])
    expect(timers).toHaveLength(1)

    timers[0]!.fn()
    expect(emitted).toEqual([
      [
        {
          type: "message.part.delta",
          properties: { messageID: "m1", partID: "p1", field: "text", delta: "Hello" },
        },
      ],
    ])
  })

  test("flushes immediately on non-delta events", () => {
    const emitted: unknown[][] = []
    const coalescer = createStreamDeltaCoalescer({
      windowMs: 50,
      schedule: () => () => undefined,
      emit: (events) => {
        emitted.push(events)
      },
    })

    coalescer.push({
      type: "message.part.delta",
      properties: { messageID: "m1", partID: "p1", field: "text", delta: "a" },
    })
    coalescer.push({
      type: "session.status",
      properties: { sessionID: "s1", status: { type: "busy" } },
    })

    expect(emitted).toEqual([
      [
        {
          type: "message.part.delta",
          properties: { messageID: "m1", partID: "p1", field: "text", delta: "a" },
        },
        {
          type: "session.status",
          properties: { sessionID: "s1", status: { type: "busy" } },
        },
      ],
    ])
  })
})
