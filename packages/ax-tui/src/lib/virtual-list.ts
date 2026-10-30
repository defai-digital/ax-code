export type VirtualListKey = string | number

export interface VirtualListAnchor {
  key: VirtualListKey
  index: number
  offset: number
}

const MAX_HEIGHT = 1_000_000
const MAX_TOTAL_HEIGHT = 1_000_000_000

function heightValue(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_HEIGHT) {
    throw new RangeError(`Virtual row height must be an integer from 1 to ${MAX_HEIGHT}`)
  }
  return value
}

/** Stable-key height index. Scroll lookup and individual measurements are O(log n). */
export class VirtualListModel<T> {
  private values: readonly T[] = []
  private keys: VirtualListKey[] = []
  private indices = new Map<VirtualListKey, number>()
  private heights: number[] = []
  private tree = new Float64Array(1)
  private measured = new Map<VirtualListKey, { item: T; height: number }>()
  private total = 0
  readonly estimateHeight: number

  constructor(private readonly getKey: (item: T) => VirtualListKey, estimateHeight = 1) {
    this.estimateHeight = heightValue(estimateHeight)
  }

  get items(): readonly T[] { return this.values }
  get count(): number { return this.values.length }
  get totalHeight(): number { return this.total }

  setItems(items: readonly T[]): void {
    const values = [...items]
    const keys: VirtualListKey[] = []
    const indices = new Map<VirtualListKey, number>()
    const measured = new Map<VirtualListKey, { item: T; height: number }>()
    const heights = values.map((item, index) => {
      const key = this.getKey(item)
      if ((typeof key !== "string" && typeof key !== "number") ||
        (typeof key === "number" && !Number.isFinite(key)) || indices.has(key)) {
        throw new TypeError("Virtual list keys must be unique strings or finite numbers")
      }
      keys.push(key)
      indices.set(key, index)
      const old = this.measured.get(key)
      if (old && Object.is(old.item, item)) {
        measured.set(key, old)
        return old.height
      }
      return this.estimateHeight
    })
    const total = heights.reduce((sum, height) => sum + height, 0)
    if (total > MAX_TOTAL_HEIGHT) throw new RangeError("Virtual list exceeds maximum total height")
    // Validation is transactional: invalid input cannot corrupt the current index.
    this.values = values
    this.keys = keys
    this.indices = indices
    this.heights = heights
    this.measured = measured
    this.total = total
    this.rebuild()
  }

  private rebuild(): void {
    this.tree = new Float64Array(this.count + 1)
    for (let index = 1; index <= this.count; index++) {
      this.tree[index] += this.heights[index - 1]
      const parent = index + (index & -index)
      if (parent <= this.count) this.tree[parent] += this.tree[index]
    }
  }

  resetMeasurements(): void {
    const total = this.count * this.estimateHeight
    if (total > MAX_TOTAL_HEIGHT) throw new RangeError("Virtual list exceeds maximum total height")
    this.measured.clear()
    this.heights.fill(this.estimateHeight)
    this.total = total
    this.rebuild()
  }

  keyAt(index: number): VirtualListKey | undefined { return this.keys[index] }
  indexOf(key: VirtualListKey): number { return this.indices.get(key) ?? -1 }
  heightAt(index: number): number { return this.heights[index] ?? 0 }

  measure(index: number, height: number): boolean {
    heightValue(height)
    if (!Number.isInteger(index) || index < 0 || index >= this.count) throw new RangeError("Invalid virtual row index")
    const delta = height - this.heights[index]
    if (this.total + delta > MAX_TOTAL_HEIGHT) throw new RangeError("Virtual list exceeds maximum total height")
    this.measured.set(this.keys[index], { item: this.values[index], height })
    if (!delta) return false
    this.heights[index] = height
    this.total += delta
    for (let next = index + 1; next <= this.count; next += next & -next) this.tree[next] += delta
    return true
  }

  offsetAt(index: number): number {
    if (!Number.isInteger(index) || index < 0 || index > this.count) throw new RangeError("Invalid virtual row index")
    let sum = 0
    for (let next = index; next > 0; next -= next & -next) sum += this.tree[next]
    return sum
  }

  indexAt(offset: number): number {
    if (!Number.isFinite(offset)) throw new RangeError("Virtual offset must be finite")
    if (!this.count) return -1
    const target = Math.max(0, offset)
    let index = 0
    let sum = 0
    for (let step = 2 ** Math.floor(Math.log2(this.count)); step >= 1; step = Math.floor(step / 2)) {
      const next = index + step
      if (next <= this.count && sum + this.tree[next] <= target) {
        index = next
        sum += this.tree[next]
      }
    }
    return Math.min(index, this.count - 1)
  }

  range(scrollTop: number, viewportHeight: number, overscan = 3): { start: number; end: number } {
    if (![scrollTop, viewportHeight, overscan].every(Number.isFinite) || viewportHeight < 0 || overscan < 0) {
      throw new RangeError("Virtual viewport and overscan must be finite and nonnegative")
    }
    if (!this.count || viewportHeight === 0) return { start: 0, end: 0 }
    const top = Math.max(0, scrollTop)
    return {
      start: this.indexAt(Math.max(0, top - overscan)),
      end: Math.min(this.count, this.indexAt(Math.max(0, top + viewportHeight + overscan - 1)) + 1),
    }
  }

  anchor(scrollTop: number): VirtualListAnchor | undefined {
    const index = this.indexAt(scrollTop)
    return index < 0 ? undefined : { key: this.keys[index], index, offset: Math.max(0, scrollTop - this.offsetAt(index)) }
  }

  resolveAnchor(anchor: VirtualListAnchor | undefined): number {
    if (!anchor || !this.count) return 0
    const found = this.indexOf(anchor.key)
    const index = found < 0 ? Math.min(anchor.index, this.count - 1) : found
    return this.offsetAt(index) + Math.min(anchor.offset, this.heightAt(index) - 1)
  }
}
