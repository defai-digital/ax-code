import { describe, expect, test } from "bun:test"
import { AsyncQueue } from "../../src/util/queue"

describe("AsyncQueue", () => {
  test("drops pushes after close and keeps size stable", async () => {
    const q = new AsyncQueue<number>()

    q.push(1)
    q.close()
    q.push(2)

    expect(q.size).toBe(1)
    expect(await q.next()).toBe(1)
    await expect(q.next()).rejects.toThrow("queue closed")
    expect(q.size).toBe(0)
  })

  test("rejects waiting next calls when closed", async () => {
    const q = new AsyncQueue<number>()
    const next = q.next()

    q.close()

    await expect(next).rejects.toThrow("queue closed")
  })
})
