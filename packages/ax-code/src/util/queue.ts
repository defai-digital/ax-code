const CLOSED = Symbol("closed")
const closed = () => new Error("queue closed")

export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: (T | typeof CLOSED)[] = []
  private resolvers: ((value: T | typeof CLOSED) => void)[] = []
  private count = 0
  private dead = false

  get size() {
    return this.count
  }

  push(item: T) {
    if (this.dead) return
    const resolve = this.resolvers.shift()
    if (resolve) resolve(item)
    else {
      this.queue.push(item)
      this.count++
    }
  }

  close() {
    if (this.dead) return
    this.dead = true
    for (const resolve of this.resolvers) resolve(CLOSED)
    this.resolvers.length = 0
    this.queue.push(CLOSED)
  }

  async next(): Promise<T> {
    if (this.queue.length > 0) {
      const item = this.queue.shift()!
      if (item === CLOSED) throw closed()
      this.count--
      return item
    }
    if (this.dead) throw closed()
    return new Promise<T>((resolve, reject) =>
      this.resolvers.push((v) => {
        if (v === CLOSED) {
          reject(closed())
          return
        }
        resolve(v as T)
      }),
    )
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      const item = await new Promise<T | typeof CLOSED>((resolve) => {
        if (this.queue.length > 0) {
          const v = this.queue.shift()!
          if (v !== CLOSED) this.count--
          resolve(v)
          return
        }
        this.resolvers.push(resolve)
      })
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
