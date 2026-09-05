/** FIFO storage with amortized constant-time removal and no retained consumed values. */
export class Fifo<T> {
  private items: (T | undefined)[] = []
  private head = 0

  get size() {
    return this.items.length - this.head
  }

  push(value: T) {
    this.items.push(value)
  }

  peek(): T | undefined {
    return this.items[this.head]
  }

  shift(): T | undefined {
    if (this.size === 0) return undefined
    const value = this.items[this.head]
    this.items[this.head++] = undefined
    if (this.head === this.items.length) this.clear()
    else if (this.head >= 1024 && this.head * 2 >= this.items.length) {
      this.items = this.items.slice(this.head)
      this.head = 0
    }
    return value
  }

  clear() {
    this.items = []
    this.head = 0
  }

  /** Copy the live suffix; offsets are relative to the first queued value. */
  toArray(start = 0): T[] {
    return this.items.slice(this.head + start) as T[]
  }
}
