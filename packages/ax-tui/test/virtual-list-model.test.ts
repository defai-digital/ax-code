import { describe, expect, test } from "vitest"
import { VirtualListModel } from "../src/lib/virtual-list.js"

describe("virtual row height index", () => {
  test("matches a linear oracle after repeated point measurements", () => {
    const model = new VirtualListModel<number>((item) => item, 2)
    const items = Array.from({ length: 10_000 }, (_, index) => index)
    model.setItems(items)
    const heights = items.map(() => 2)
    let seed = 12345
    for (let iteration = 0; iteration < 300; iteration++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const index = seed % items.length
      const height = 1 + seed % 23
      heights[index] = height
      model.measure(index, height)
      expect(model.offsetAt(index)).toBe(heights.slice(0, index).reduce((a, b) => a + b, 0))
      expect(model.indexAt(model.offsetAt(index))).toBe(index)
      expect(model.indexAt(model.offsetAt(index) + height - 1)).toBe(index)
    }
    expect(model.totalHeight).toBe(heights.reduce((a, b) => a + b, 0))
    const range = model.range(8000, 25, 5)
    expect(range.end - range.start).toBeLessThanOrEqual(35)
    expect(model.offsetAt(range.start)).toBeLessThanOrEqual(7995)
    expect(model.offsetAt(range.end)).toBeGreaterThanOrEqual(8030)
  })

  test("preserves stable-key measurements and anchors across prepend and removal", () => {
    const a = { id: "a" }, b = { id: "b" }, c = { id: "c" }
    const model = new VirtualListModel<{ id: string }>((item) => item.id, 2)
    model.setItems([a, b, c])
    model.measure(1, 5)
    const anchor = model.anchor(4)
    model.setItems([{ id: "new" }, a, b, c])
    expect(model.heightAt(2)).toBe(5)
    expect(model.resolveAnchor(anchor)).toBe(6)
    model.setItems([a, c])
    expect(model.resolveAnchor(anchor)).toBe(3)
    model.setItems([a, { id: "c" }])
    expect(model.totalHeight).toBe(4)
    model.resetMeasurements()
    model.setItems([])
    expect(model.totalHeight).toBe(0)
    expect(model.anchor(0)).toBeUndefined()
    expect(model.range(0, 10)).toEqual({ start: 0, end: 0 })
  })

  test("rejects invalid geometry and duplicate keys without changing live state", () => {
    const model = new VirtualListModel<string>((item) => item)
    model.setItems(["one", "two"])
    expect(() => model.setItems(["duplicate", "duplicate"])).toThrow()
    expect(model.items).toEqual(["one", "two"])
    for (const height of [NaN, Infinity, -1, 0, 0.5, 1_000_001]) expect(() => model.measure(0, height)).toThrow()
    expect(model.totalHeight).toBe(2)
    expect(() => model.offsetAt(-1)).toThrow()
    expect(() => model.indexAt(NaN)).toThrow()
    expect(() => model.range(0, 10, -1)).toThrow()
    expect(model.range(0, 0)).toEqual({ start: 0, end: 0 })
  })
})
