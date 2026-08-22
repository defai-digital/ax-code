import { describe, expect, test } from "vitest"
import { percentile, ratio, round, summarizeDurations } from "../src/metrics"

describe("percentile", () => {
  test("returns 0 for empty input", () => {
    expect(percentile([], 50)).toBe(0)
    expect(percentile([], 95)).toBe(0)
  })

  test("returns the only sample for single-element input", () => {
    expect(percentile([42], 50)).toBe(42)
    expect(percentile([42], 95)).toBe(42)
  })

  test("uses floor indexing, matching src/perf.ts semantics", () => {
    const sorted = [10, 20, 30, 40]
    expect(percentile(sorted, 50)).toBe(30) // floor(0.5 * 4) = 2
    expect(percentile(sorted, 95)).toBe(40) // floor(3.8) = 3
    expect(percentile(sorted, 0)).toBe(10)
    expect(percentile(sorted, 100)).toBe(40) // clamped to last element
  })
})

describe("summarizeDurations", () => {
  test("aggregates samples, percentiles, and total", () => {
    expect(summarizeDurations([40, 10, 30, 20])).toEqual({ samples: 4, p50: 30, p95: 40, totalMs: 100 })
  })

  test("handles empty input", () => {
    expect(summarizeDurations([])).toEqual({ samples: 0, p50: 0, p95: 0, totalMs: 0 })
  })
})

describe("ratio", () => {
  test("returns undefined for an empty denominator instead of NaN", () => {
    expect(ratio(0, 0)).toBeUndefined()
    expect(ratio(5, 0)).toBeUndefined()
  })

  test("computes the ratio otherwise", () => {
    expect(ratio(1, 4)).toBe(0.25)
  })
})

describe("round", () => {
  test("rounds to two decimals", () => {
    expect(round(1.006)).toBe(1.01)
    expect(round(1.004)).toBe(1)
    expect(round(2)).toBe(2)
  })
})
