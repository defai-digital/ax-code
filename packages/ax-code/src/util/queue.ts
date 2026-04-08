export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: T[] = []
  private resolvers: ((value: T | undefined) => void)[] = []
  private done = false

  get size() {
    return this.queue.length
  }

  push(item: T) {
    const resolve = this.resolvers.shift()
    if (resolve) resolve(item)
    else this.queue.push(item)
  }

  close() {
    this.done = true
    for (const resolve of this.resolvers) resolve(undefined)
    this.resolvers.length = 0
  }

  async next(): Promise<T | undefined> {
    if (this.queue.length > 0) return this.queue.shift()!
    if (this.done) return undefined
    return new Promise((resolve) => this.resolvers.push(resolve))
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      const item = await this.next()
      if (item === undefined) return
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
