import { describe, expect, test } from "bun:test"
import { AsyncQueue } from "../../src/util/queue"
import { pushSseFrame, SSE_HARD_MAX } from "../../src/server/sse-queue"

describe("server/sse-queue", () => {
  test("enqueues frames while under the hard limit", () => {
    const q = new AsyncQueue<string | null>()

    expect(pushSseFrame(q, { type: "server.connected" })).toBe("queued")
    expect(q.size).toBe(1)
  })

  test("continues enqueueing frames past the former soft limit", () => {
    const q = new AsyncQueue<string | null>()
    for (let i = 0; i < 1024; i++) {
      q.push(`seed-${i}`)
    }

    expect(pushSseFrame(q, { type: "tool.result" })).toBe("queued")
    expect(q.size).toBe(1025)
  })

  test("enqueues the final frame before the hard limit", () => {
    const q = new AsyncQueue<string | null>()
    for (let i = 0; i < SSE_HARD_MAX - 1; i++) {
      q.push(`seed-${i}`)
    }

    expect(
      pushSseFrame(q, {
        type: "tool.result",
        properties: {},
      }),
    ).toBe("queued")
    expect(q.size).toBe(SSE_HARD_MAX)
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
