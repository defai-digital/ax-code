import { describe, expect, test } from "bun:test"
import { AsyncQueue } from "../../src/util/queue"
import { pushSseFrame, SSE_HARD_MAX, SSE_SOFT_MAX } from "../../src/server/sse-queue"

describe("server/sse-queue", () => {
  test("enqueues frames while under the soft limit", () => {
    const q = new AsyncQueue<string | null>()

    expect(pushSseFrame(q, { type: "server.connected" })).toBe("queued")
    expect(q.size).toBe(1)
  })

  test("drops non-delta frames once the queue reaches the soft limit", () => {
    const q = new AsyncQueue<string | null>()
    for (let i = 0; i < SSE_SOFT_MAX; i++) {
      q.push(`seed-${i}`)
    }

    expect(pushSseFrame(q, { type: "tool.result" })).toBe("dropped")
    expect(q.size).toBe(SSE_SOFT_MAX)
  })

  test("drops heartbeat frames once the queue reaches the soft limit", () => {
    const q = new AsyncQueue<string | null>()
    for (let i = 0; i < SSE_SOFT_MAX; i++) {
      q.push(`seed-${i}`)
    }

    expect(
      pushSseFrame(q, {
        type: "server.heartbeat",
        properties: {},
      }),
    ).toBe("dropped")
    expect(q.size).toBe(SSE_SOFT_MAX)
  })

  test("signals overflow once the hard limit is reached", () => {
    const q = new AsyncQueue<string | null>()
    for (let i = 0; i < SSE_HARD_MAX; i++) {
      q.push(`seed-${i}`)
    }

    expect(pushSseFrame(q, { type: "server.heartbeat" })).toBe("overflow")
    expect(q.size).toBe(SSE_HARD_MAX)
  })
})
