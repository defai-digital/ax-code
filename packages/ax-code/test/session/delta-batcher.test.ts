import { describe, expect, test, vi } from "vitest"
import { createDeltaBatcher } from "../../src/session/delta-batcher"

/** Let every queued microtask and zero-delay timer run. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe("createDeltaBatcher", () => {
  test("coalesces deltas for the same part within the window", async () => {
    const publishes: Array<{ partID: string; delta: string }> = []
    let scheduled: (() => void) | undefined
    const batcher = createDeltaBatcher({
      sessionID: "ses_1",
      messageID: "msg_1",
      windowMs: 50,
      publish: (event) => {
        publishes.push({ partID: event.partID, delta: event.delta })
      },
      schedule: (fn) => {
        scheduled = fn
        return { clear: () => undefined }
      },
    })

    batcher.push("part_a", "hel")
    batcher.push("part_a", "lo")
    batcher.push("part_b", "x")
    expect(publishes).toEqual([])
    expect(scheduled).toBeTypeOf("function")
    scheduled!()
    await Promise.resolve()
    expect(publishes).toEqual([
      { partID: "part_a", delta: "hello" },
      { partID: "part_b", delta: "x" },
    ])
  })

  test("flush clears the timer and publishes immediately", async () => {
    const publishes: string[] = []
    let cleared = false
    const batcher = createDeltaBatcher({
      sessionID: "ses_1",
      messageID: "msg_1",
      publish: (event) => {
        publishes.push(event.delta)
      },
      schedule: () => ({
        clear: () => {
          cleared = true
        },
      }),
    })
    batcher.push("p1", "a")
    batcher.push("p1", "b")
    await batcher.flush()
    expect(cleared).toBe(true)
    expect(publishes).toEqual(["ab"])
  })

  test("reports flush errors via onFlushError", async () => {
    const onFlushError = vi.fn()
    let scheduled: (() => void) | undefined
    const batcher = createDeltaBatcher({
      sessionID: "ses_1",
      messageID: "msg_1",
      publish: async () => {
        throw new Error("publish failed")
      },
      onFlushError,
      schedule: (fn) => {
        scheduled = fn
        return { clear: () => undefined }
      },
    })
    batcher.push("p1", "x")
    scheduled!()
    await new Promise((r) => setTimeout(r, 0))
    expect(onFlushError).toHaveBeenCalled()
    expect(String(onFlushError.mock.calls[0]![0])).toContain("publish failed")
  })

  test("a synchronously throwing publish still publishes the other parts and reports once", async () => {
    const published: string[] = []
    const onFlushError = vi.fn()
    let scheduled: (() => void) | undefined
    const batcher = createDeltaBatcher({
      sessionID: "ses_1",
      messageID: "msg_1",
      publish: (event) => {
        if (event.partID === "p1") throw new Error("sync publish failed")
        published.push(event.partID)
      },
      onFlushError,
      schedule: (fn) => {
        scheduled = fn
        return { clear: () => undefined }
      },
    })
    batcher.push("p1", "x")
    batcher.push("p2", "y")
    expect(() => scheduled!()).not.toThrow()
    await new Promise((r) => setTimeout(r, 0))
    expect(published).toEqual(["p2"])
    expect(onFlushError).toHaveBeenCalledTimes(1)
    expect(String(onFlushError.mock.calls[0]![0])).toContain("sync publish failed")
  })

  test("each flushed batch carries the offset of its first chunk", async () => {
    const publishes: Array<{ partID: string; delta: string; offset?: number }> = []
    let scheduled: (() => void) | undefined
    const batcher = createDeltaBatcher({
      sessionID: "ses_1",
      messageID: "msg_1",
      publish: (event) => {
        publishes.push({ partID: event.partID, delta: event.delta, offset: event.offset })
      },
      schedule: (fn) => {
        scheduled = fn
        return { clear: () => undefined }
      },
    })

    batcher.push("part_a", "hel", 0)
    batcher.push("part_a", "lo", 3)
    scheduled!()
    await Promise.resolve()
    expect(publishes).toEqual([{ partID: "part_a", delta: "hello", offset: 0 }])

    // After a flush, the next batch carries the offset of its own first
    // chunk — the client reconciles against already-published text.
    batcher.push("part_a", " world", 5)
    scheduled!()
    await Promise.resolve()
    expect(publishes[1]).toEqual({ partID: "part_a", delta: " world", offset: 5 })
  })

  test("flush waits for an earlier in-flight batch and keeps later batches ordered", async () => {
    const events: string[] = []
    const gates: Array<() => void> = []
    let scheduled: (() => void) | undefined
    const batcher = createDeltaBatcher({
      sessionID: "ses_1",
      messageID: "msg_1",
      publish: (event) => {
        events.push(`start:${event.delta}`)
        return new Promise<void>((resolve) => {
          gates.push(() => {
            events.push(`end:${event.delta}`)
            resolve()
          })
        })
      },
      schedule: (fn) => {
        scheduled = fn
        return { clear: () => undefined }
      },
    })

    // A timer-driven flush is still waiting on its subscriber when the next
    // deltas arrive.
    batcher.push("p1", "a")
    scheduled!()
    await tick()
    expect(events).toEqual(["start:a"])

    batcher.push("p1", "b")
    const flushed = batcher.flush()
    expect(flushed).toBeInstanceOf(Promise)
    if (!flushed) throw new Error("flush did not return a promise")
    await tick()
    // "b" must not overtake the publish of "a" that is still in flight.
    expect(events).toEqual(["start:a"])

    // An empty flush must still drain work queued by an earlier flush.
    const drained = batcher.flush()
    expect(drained).toBeInstanceOf(Promise)
    if (!drained) throw new Error("drain did not return a promise")
    let drainedDone = false
    void drained.then(() => {
      drainedDone = true
    })

    gates[0]!()
    await tick()
    expect(events).toEqual(["start:a", "end:a", "start:b"])
    expect(drainedDone).toBe(false)

    gates[1]!()
    await flushed
    await drained
    expect(events).toEqual(["start:a", "end:a", "start:b", "end:b"])
    expect(drainedDone).toBe(true)

    await tick()
    expect(batcher.flush()).toBeUndefined()
  })

  test("a failed batch does not block a later flush", async () => {
    const published: string[] = []
    const onFlushError = vi.fn()
    let scheduled: (() => void) | undefined
    let fail = true
    const batcher = createDeltaBatcher({
      sessionID: "ses_1",
      messageID: "msg_1",
      publish: async (event) => {
        if (fail) throw new Error("publish failed")
        published.push(event.delta)
      },
      onFlushError,
      schedule: (fn) => {
        scheduled = fn
        return { clear: () => undefined }
      },
    })

    batcher.push("p1", "a")
    scheduled!()
    await tick()
    expect(onFlushError).toHaveBeenCalledTimes(1)

    fail = false
    batcher.push("p1", "b")
    await batcher.flush()
    expect(published).toEqual(["b"])
    expect(onFlushError).toHaveBeenCalledTimes(1)
  })
})
