import { describe, expect, test } from "bun:test"
import { AsyncQueue } from "../../src/util/queue"

describe("util.queue", () => {
  test("next() rejects immediately after the queue has been closed and drained", async () => {
    const q = new AsyncQueue<number>()

    q.push(1)
    q.close()

    await expect(q.next()).resolves.toBe(1)
    await expect(q.next()).rejects.toThrow("AsyncQueue is closed")
    await expect(q.next()).rejects.toThrow("AsyncQueue is closed")
  })

  test("close() wakes waiting consumers", async () => {
    const q = new AsyncQueue<number>()
    const pending = q.next()

    q.close()

    await expect(pending).rejects.toThrow("AsyncQueue is closed")
  })
})
