import { describe, expect, test } from "bun:test"
import { sessionQualityActions } from "../../../src/cli/cmd/tui/routes/session/quality"

describe("tui session quality actions", () => {
  test("builds capture evidence actions when no replay items are exportable yet", () => {
    const actions = sessionQualityActions({
      sessionID: "ses_capture",
      quality: {
        review: {
          workflow: "review",
          overallStatus: "fail",
          readyForBenchmark: false,
          resolvedLabeledItems: 0,
          totalItems: 0,
          nextAction: "Capture review workflow activity before exporting replay again.",
        },
        debug: null,
      },
    })

    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      workflow: "review",
      kind: "capture_evidence",
      title: "Capture Review Evidence",
    })
    expect(actions[0]?.prompt.input).toContain("session ses_capture")
    expect(actions[0]?.prompt.input).toContain("produce review workflow evidence")
  })

  test("builds label coverage actions when replay evidence exists but labels are incomplete", () => {
    const actions = sessionQualityActions({
      sessionID: "ses_label",
      quality: {
        review: {
          workflow: "review",
          overallStatus: "warn",
          readyForBenchmark: false,
          resolvedLabeledItems: 1,
          totalItems: 3,
          nextAction: "Finish label coverage for the remaining exported artifacts.",
        },
        debug: null,
      },
    })

    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      workflow: "review",
      kind: "finish_label_coverage",
      title: "Finish Review Label Coverage",
    })
    expect(actions[0]?.description).toContain("1/3 resolved labels")
    expect(actions[0]?.prompt.input).toContain("still need resolved outcome labels")
  })

  test("builds benchmark actions when workflow readiness is benchmark-ready", () => {
    const actions = sessionQualityActions({
      sessionID: "ses_benchmark",
      quality: {
        review: null,
        debug: {
          workflow: "debug",
          overallStatus: "pass",
          readyForBenchmark: true,
          resolvedLabeledItems: 2,
          totalItems: 2,
          nextAction: null,
        },
      },
    })

    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      workflow: "debug",
      kind: "benchmark",
      title: "Benchmark Debug Replay",
      footer: "Ready to benchmark the current replay export.",
    })
    expect(actions[0]?.prompt.input).toContain("benchmark flow for session ses_benchmark and workflow debug")
  })
})
