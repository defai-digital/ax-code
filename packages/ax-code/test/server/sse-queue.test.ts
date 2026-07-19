import { describe, expect, test } from "vitest"
import { AsyncQueue } from "../../src/util/queue"
import { encodeSsePayload, pushSseFrame, SSE_HARD_MAX, SSE_WARN_THRESHOLD } from "../../src/server/sse-queue"

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

  test("returns warning once the warn threshold is crossed", () => {
    const q = new AsyncQueue<string | null>()
    for (let i = 0; i < SSE_WARN_THRESHOLD - 1; i++) {
      q.push(`seed-${i}`)
    }

    expect(pushSseFrame(q, { type: "tool.result" })).toBe("warning")
    expect(q.size).toBe(SSE_WARN_THRESHOLD)
  })

  test("enqueues the final frame before the hard limit", () => {
    const q = new AsyncQueue<string | null>()
    for (let i = 0; i < SSE_HARD_MAX - 1; i++) {
      q.push(`seed-${i}`)
    }

    // Frame is still enqueued, but returns "warning" since we're above the warn threshold
    expect(
      pushSseFrame(q, {
        type: "tool.result",
        properties: {},
      }),
    ).toBe("warning")
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

  test("encodes bigint and circular payloads without throwing", async () => {
    const q = new AsyncQueue<string | null>()
    const payload: Record<string, unknown> = {
      type: "tool.result",
      properties: {
        sequence: 1n,
      },
    }
    payload.self = payload

    expect(pushSseFrame(q, payload)).toBe("queued")

    const frame = await q.next()
    expect(frame).not.toBeNull()
    expect(JSON.parse(frame as string)).toEqual({
      type: "tool.result",
      properties: {
        sequence: "1",
      },
      self: "[Circular]",
    })
  })

  test("encodes a serialization error frame when JSON conversion throws", () => {
    const encoded = encodeSsePayload({
      toJSON() {
        throw new Error("cannot serialize")
      },
    })

    expect(JSON.parse(encoded)).toEqual({
      type: "server.serialization_error",
      properties: {
        error: "cannot serialize",
      },
    })
  })
})
