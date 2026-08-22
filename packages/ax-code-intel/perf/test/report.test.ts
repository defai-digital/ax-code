import { describe, expect, test } from "vitest"
import type { ScenarioResult } from "../src/metrics"
import {
  baselineFileName,
  buildBaseline,
  collectMeta,
  compareResults,
  formatComparisonMarkdown,
  formatMarkdownTable,
  parseBaseline,
} from "../src/report"

const result = (overrides: Partial<ScenarioResult> = {}): ScenarioResult => ({
  scenario: "cold-start",
  language: "rust",
  serverId: "rust",
  samples: 5,
  p50: 100,
  p95: 200,
  totalMs: 600,
  ...overrides,
})

describe("baseline files", () => {
  test("buildBaseline wraps results with versioned meta", () => {
    const meta = collectMeta("smoke", false)
    const baseline = buildBaseline([result()], meta)
    expect(baseline.version).toBe(1)
    expect(baseline.meta.node).toMatch(/^v\d+/)
    expect(baseline.results).toHaveLength(1)
  })

  test("baselineFileName is baseline-<YYYYMMDD>-<host>-node<major>.json", () => {
    const name = baselineFileName({
      ...collectMeta("full", false),
      recordedAt: "2026-08-22T10:00:00.000Z",
      host: "dev box",
    })
    expect(name).toMatch(/^baseline-20260822-dev_box-node\d+\.json$/)
  })

  test("parseBaseline round-trips and rejects malformed payloads", () => {
    const baseline = buildBaseline([result()], collectMeta("smoke", false))
    expect(parseBaseline(JSON.stringify(baseline))).toEqual(baseline)
    expect(() => parseBaseline("{}")).toThrow()
    expect(() => parseBaseline('{"version":2,"meta":{},"results":[]}')).toThrow()
  })
})

describe("formatMarkdownTable", () => {
  test("renders one row per result with optional metrics", () => {
    const table = formatMarkdownTable([result({ peakRssKb: 204800, hitRate: 0.75, rpcCount: 12 })])
    expect(table).toContain("| scenario | language | server |")
    expect(table).toContain("| cold-start | rust | rust | 5 | 100 | 200 | 200 | 0.75 | 12 | 600 |")
  })

  test("renders a dash for absent optional metrics", () => {
    expect(formatMarkdownTable([result()])).toContain("| 5 | 100 | 200 | — | — | — | 600 |")
  })
})

describe("compareResults", () => {
  const reference = [result({ p95: 100, hitRate: 0.9 })]

  test("flags a latency regression beyond the threshold", () => {
    const rows = compareResults([result({ p95: 130, hitRate: 0.9 })], reference, 20)
    const p95 = rows.find((row) => row.metric === "p95")
    expect(p95?.deltaPct).toBe(30)
    expect(p95?.regression).toBe(true)
  })

  test("treats improvements and small deltas as non-regressions", () => {
    const rows = compareResults([result({ p95: 85, hitRate: 0.95 })], reference, 20)
    expect(rows.find((row) => row.metric === "p95")?.regression).toBe(false)
    expect(rows.find((row) => row.metric === "hitRate")?.regression).toBe(false)
  })

  test("flags a hit-rate drop beyond the threshold", () => {
    const rows = compareResults([result({ p95: 100, hitRate: 0.6 })], reference, 20)
    const hitRate = rows.find((row) => row.metric === "hitRate")
    expect(hitRate?.deltaPct).toBe(-33.33)
    expect(hitRate?.regression).toBe(true)
  })

  test("skips metrics absent on either side and scenarios without a reference row", () => {
    const rows = compareResults([result({ rpcCount: 10 }), result({ scenario: "graph-builder" })], reference, 20)
    expect(rows.some((row) => row.metric === "rpcCount")).toBe(false) // reference has no rpcCount
    expect(rows.some((row) => row.scenario === "graph-builder")).toBe(false)
  })

  test("formatComparisonMarkdown marks regressions", () => {
    const rows = compareResults([result({ p95: 500, hitRate: 0.9 })], reference, 20)
    const markdown = formatComparisonMarkdown(rows)
    expect(markdown).toContain("REGRESSION")
    expect(markdown).toContain("400%")
  })
})
