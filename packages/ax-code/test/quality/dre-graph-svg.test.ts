import { describe, expect, test } from "vitest"
import { clip, formatDuration, linear, niceTicks } from "../../src/quality/dre-graph/dre-graph-svg"

describe("quality.dre-graph-svg", () => {
  test("niceTicks starts at zero, uses round steps, and covers the maximum", () => {
    const ticks = niceTicks(12_300, 5)
    expect(ticks[0]).toBe(0)
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(12_300)
    const steps = ticks.slice(1).map((tick, i) => tick - ticks[i])
    expect(new Set(steps).size).toBe(1)
    expect([1, 2, 5].includes(Number((steps[0] / 10 ** Math.floor(Math.log10(steps[0]))).toFixed(6)))).toBe(true)
  })

  test("niceTicks survives zero, negative and non-finite maxima", () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const ticks = niceTicks(bad)
      expect(ticks.length).toBeGreaterThan(1)
      expect(ticks.every(Number.isFinite)).toBe(true)
    }
  })

  test("linear scales proportionally and never returns NaN", () => {
    const x = linear(200, 100)
    expect(x(0)).toBe(0)
    expect(x(100)).toBe(50)
    expect(linear(0, 100)(5)).toBe(0)
    expect(x(Number.NaN)).toBe(0)
  })

  test("formatDuration picks a readable unit", () => {
    expect(formatDuration(0)).toBe("0ms")
    expect(formatDuration(850)).toBe("850ms")
    expect(formatDuration(1200)).toBe("1.2s")
    expect(formatDuration(12_000)).toBe("12s")
    expect(formatDuration(125_000)).toBe("2m 5s")
    expect(formatDuration(3_600_000)).toBe("1h 0m")
    expect(formatDuration(19_286_000)).toBe("5h 21m")
    expect(formatDuration(Number.NaN)).toBe("0ms")
  })

  test("clip keeps short text and ellipsizes long text by code points", () => {
    expect(clip("bash", 24)).toBe("bash")
    expect(clip("a".repeat(30), 10)).toBe(`${"a".repeat(9)}…`)
    expect(Array.from(clip("😀".repeat(10), 5))).toHaveLength(5)
  })
})
