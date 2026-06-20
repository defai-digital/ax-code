import { describe, expect, test } from "vitest"
import { KeyedSerialQueue } from "../../src/util/queue"

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

async function flush(count = 3) {
  for (let i = 0; i < count; i++) await Promise.resolve()
}

describe("KeyedSerialQueue", () => {
  test("serializes work for the same key and cleans up when idle", async () => {
    const queue = new KeyedSerialQueue()
    const releaseFirst = deferred()
    const order: string[] = []

    const first = queue.run("a", async () => {
      order.push("first:start")
      await releaseFirst.promise
      order.push("first:end")
    })
    const second = queue.run("a", async () => {
      order.push("second")
    })

    await flush()
    expect(order).toEqual(["first:start"])
    expect(queue.size()).toBe(1)

    releaseFirst.resolve()
    await Promise.all([first, second])

    expect(order).toEqual(["first:start", "first:end", "second"])
    expect(queue.size()).toBe(0)
  })

  test("allows different keys to run concurrently", async () => {
    const queue = new KeyedSerialQueue()
    const release = deferred()
    const started: string[] = []

    const first = queue.run("a", async () => {
      started.push("a")
      await release.promise
    })
    const second = queue.run("b", async () => {
      started.push("b")
      await release.promise
    })

    await flush()
    expect(started.sort()).toEqual(["a", "b"])
    expect(queue.size()).toBe(2)

    release.resolve()
    await Promise.all([first, second])
    expect(queue.size()).toBe(0)
  })

  test("continues queued work after a failure", async () => {
    const queue = new KeyedSerialQueue()
    const order: string[] = []

    const first = queue.run("a", async () => {
      order.push("first")
      throw new Error("boom")
    })
    const second = queue.run("a", async () => {
      order.push("second")
      return "ok"
    })

    await expect(first).rejects.toThrow("boom")
    await expect(second).resolves.toBe("ok")
    expect(order).toEqual(["first", "second"])
    expect(queue.size()).toBe(0)
  })

  test("clear drops registry entries without cancelling already chained work", async () => {
    const queue = new KeyedSerialQueue()
    const releaseFirst = deferred()
    const order: string[] = []

    const first = queue.run("a", async () => {
      await releaseFirst.promise
      order.push("first")
    })
    const second = queue.run("a", async () => {
      order.push("second")
    })

    await flush()
    expect(queue.size()).toBe(1)

    queue.clear()
    expect(queue.size()).toBe(0)

    await queue.run("a", async () => {
      order.push("third")
    })
    expect(order).toEqual(["third"])

    releaseFirst.resolve()
    await Promise.all([first, second])
    expect(order).toEqual(["third", "first", "second"])
    expect(queue.size()).toBe(0)
  })
})
