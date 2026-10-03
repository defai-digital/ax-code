import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { clip, formatDuration, linear, niceTicks } from "../../src/quality/dre-graph/dre-graph-svg"

describe("quality.dre-graph-svg", () => {
  test("extreme domains and target counts finish with finite, bounded ticks", () => {
    const source = fileURLToPath(new URL("../../src/quality/dre-graph/dre-graph-svg.ts", import.meta.url))
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `
      import { niceTicks } from ${JSON.stringify(source)};
      console.log(JSON.stringify([
        niceTicks(Number.MIN_VALUE), niceTicks(10, Infinity), niceTicks(10, NaN),
        niceTicks(1e-20), niceTicks(Number.MAX_VALUE, 1), niceTicks(10, 1e9)
      ]));
    `,
      ],
      { encoding: "utf8", timeout: 2500, maxBuffer: 20000 },
    )
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    const domains = [Number.MIN_VALUE, 10, 10, 1e-20, Number.MAX_VALUE, 10]
    const rows = JSON.parse(result.stdout) as number[][]
    rows.forEach((ticks, index) => {
      expect(ticks.length).toBeGreaterThan(1)
      expect(ticks.length).toBeLessThanOrEqual(101)
      expect(ticks.every(Number.isFinite)).toBe(true)
      expect(ticks.at(-1)).toBeGreaterThanOrEqual(domains[index]!)
      expect(ticks.every((tick, i) => i === 0 || tick > ticks[i - 1]!)).toBe(true)
    })
  })

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

test("clip honors zero, negative and fractional column budgets", () => {
  expect(clip("hello", 0)).toBe("")
  expect(clip("hello", -2)).toBe("")
  expect(clip("hello", NaN)).toBe("")
  expect(clip("hello", 1.9)).toBe("…")
  expect(clip("hello", Infinity)).toBe("hello")
})
