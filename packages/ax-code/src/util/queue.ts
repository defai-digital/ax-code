const CLOSED = Symbol("closed")

/**
 * An async queue that supports both `next()` and `for await...of` iteration.
 *
 * Invariants:
 * - `count` tracks the number of non-CLOSED items in the internal queue.
 * - Items resolved directly via pending resolvers never touch `count`.
 * - The CLOSED sentinel does not affect `count`.
 *
 * Note: `next()` throws when the queue is closed and drained, while the
 * async iterator returns gracefully. Use the iterator for consumption
 * patterns that should terminate cleanly on close.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: (T | typeof CLOSED)[] = []
  private resolvers: ((value: T | typeof CLOSED) => void)[] = []
  private count = 0
  private closed = false

  get size() {
    return this.count
  }

  push(item: T) {
    if (this.closed) return
    const resolve = this.resolvers.shift()
    if (resolve) resolve(item)
    else {
      this.queue.push(item)
      this.count++
    }
  }

  close() {
    if (this.closed) return
    this.closed = true
    for (const resolve of this.resolvers) resolve(CLOSED)
    this.resolvers.length = 0
    this.queue.push(CLOSED)
  }

  async next(): Promise<T> {
    if (this.queue.length > 0) {
      const item = this.queue.shift()!
      if (item === CLOSED) throw new Error("AsyncQueue is closed")
      this.count--
      return item
    }
    if (this.closed) throw new Error("AsyncQueue is closed")
    return new Promise<T>((resolve, reject) =>
      this.resolvers.push((v) => {
        if (v === CLOSED) reject(new Error("AsyncQueue is closed"))
        else resolve(v as T)
      }),
    )
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      let item: T | typeof CLOSED
      if (this.queue.length > 0) {
        item = this.queue.shift()!
        // Only decrement count for real items; CLOSED sentinel doesn't affect count.
        if (item !== CLOSED) this.count--
      } else if (this.closed) {
        return
      } else {
        item = await new Promise<T | typeof CLOSED>((resolve) => {
          this.resolvers.push(resolve)
        })
      }
      if (item === CLOSED) return
      yield item
    }
  }
}

export async function work<T>(concurrency: number, items: T[], fn: (item: T) => Promise<void>) {
  const pending = [...items]
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const item = pending.pop()
        if (item === undefined) return
        await fn(item)
      }
    }),
  )
}

// In-process keyed serialization for long async operations.
//
// Use this when callers need work for the same key to run one-at-a-time, but
// work for different keys may run concurrently. This is not a cache or an
// in-flight deduper: every submitted function still runs.
export class KeyedSerialQueue {
  private tails = new Map<string, Promise<unknown>>()

  size(): number {
    return this.tails.size
  }

  // Clears registry entries for future submissions. Already-started work and
  // already-chained waiters keep running; this is useful during teardown when
  // new work should not wait on stale tails, but it is not cancellation.
  clear(): void {
    this.tails.clear()
  }

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    const tail = next.catch(() => undefined)

    this.tails.set(key, tail)
    tail.finally(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key)
    })

    return next
  }
}
