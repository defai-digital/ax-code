import { describe, expect, test, vi } from "vitest"
import { createDeltaBatcher } from "../../src/session/delta-batcher"

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
})
