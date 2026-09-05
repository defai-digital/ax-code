import { describe, expect, test } from "vitest"
import { AsyncQueue } from "../../src/util/queue"

describe("util.queue", () => {
  test("drains buffered values through iteration after close", async () => {
    const q = new AsyncQueue<number | null | undefined>()
    q.push(undefined)
    q.push(null)
    q.push(0)
    q.close()
    q.close()
    q.push(99)
    expect(q.size).toBe(3)
    expect(await Array.fromAsync(q)).toEqual([undefined, null, 0])
    expect(q.size).toBe(0)
    expect(await Array.fromAsync(q)).toEqual([])
    await expect(q.next()).rejects.toThrow("AsyncQueue is closed")
  })

  test("hands values to mixed waiting consumers in FIFO order without buffering", async () => {
    const q = new AsyncQueue<number | undefined>()
    const first = q.next()
    const iterator = q[Symbol.asyncIterator]()
    const second = iterator.next()
    const third = q.next()
    q.push(undefined)
    q.push(2)
    q.close()
    await expect(first).resolves.toBeUndefined()
    await expect(second).resolves.toEqual({ value: 2, done: false })
    await expect(third).rejects.toThrow("AsyncQueue is closed")
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true })
    expect(q.size).toBe(0)
  })

  test("closes all waiting iterators normally", async () => {
    const q = new AsyncQueue<number>()
    const pending = Array.from({ length: 4 }, () => q[Symbol.asyncIterator]().next())
    q.close()
    expect(await Promise.all(pending)).toEqual(Array.from({ length: 4 }, () => ({ value: undefined, done: true })))
  })

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
