import { describe, expect, test } from "vitest"
import { AsyncQueue, work } from "../../src/util/queue"

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

test("work retains ownership of active workers after a sibling fails", async () => {
  const active = Promise.withResolvers<void>()
  const failed = Promise.withResolvers<void>()
  const failure = new Error("worker failed")
  const visited: number[] = []
  let settled = false
  const result = work(2, [0, 1, 2], async (item) => {
    visited.push(item)
    if (item === 2) {
      failed.resolve()
      throw failure
    }
    await active.promise
  }).then(
    () => {
      settled = true
      return undefined
    },
    (error) => {
      settled = true
      return error
    },
  )
  await failed.promise
  // Drain promise callbacks without depending on timer or machine speed.
  await new Promise<void>((resolve) => setImmediate(resolve))
  const settledBeforeRelease = settled
  active.resolve()
  expect(await result).toBe(failure)
  expect(settledBeforeRelease).toBe(false)
  expect(visited).toEqual([2, 1])
})
