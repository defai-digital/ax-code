import { describe, expect, test } from "bun:test"
import {
  findTuiPerformanceCriterion,
  listTuiPerformanceCriteria,
  TUI_PERFORMANCE_CRITERIA_VERSION,
} from "../../../src/cli/cmd/tui/performance-criteria"
import { TUI_RENDER_FRAME_BUDGET_MS, TUI_RENDER_TARGET_FPS } from "../../../src/cli/cmd/tui/renderer"

describe("tui performance criteria", () => {
  test("keeps a versioned criteria contract", () => {
    expect(TUI_PERFORMANCE_CRITERIA_VERSION).toBe(1)
    expect(listTuiPerformanceCriteria().map((criterion) => criterion.id)).toEqual([
      "renderer.frame-budget",
      "startup.first-frame",
      "input.keypress-echo",
      "transcript.large-append",
      "scroll.long-cjk-wrapped",
    ])
  })

  test("requires concrete targets and measurement plans", () => {
    const criteria = listTuiPerformanceCriteria()
    const ids = new Set(criteria.map((criterion) => criterion.id))

    expect(ids.size).toBe(criteria.length)

    for (const criterion of criteria) {
      expect(criterion.workload.length).toBeGreaterThan(20)
      expect(criterion.measurement.length).toBeGreaterThan(20)
      expect(["release-blocking", "benchmark-before-rewrite"]).toContain(criterion.gate)

      const targetValues = Object.values(criterion.target).filter((value) => typeof value === "number")
      expect(targetValues.length).toBeGreaterThan(0)
      for (const value of targetValues) {
        expect(value).toBeGreaterThan(0)
      }
    }
  })

  test("aligns the frame-budget criterion with renderer options", () => {
    const criterion = findTuiPerformanceCriterion("renderer.frame-budget")

    expect(criterion?.target.minFps).toBe(TUI_RENDER_TARGET_FPS)
    expect(criterion?.target.p95Ms).toBe(Math.ceil(TUI_RENDER_FRAME_BUDGET_MS))
  })
})
