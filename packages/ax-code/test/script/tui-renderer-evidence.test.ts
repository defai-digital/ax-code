import { describe, expect, test } from "bun:test"
import { benchmarkIssues, validateBenchmarkReport, validateEvidenceFile } from "../../script/tui-renderer-evidence"

describe("script.tui-renderer-evidence", () => {
  test("converts benchmark report failures into renderer evidence issues", () => {
    const issues = benchmarkIssues(
      {
        results: [
          {
            id: "startup.first-frame:pty-first-frame",
            criterionID: "startup.first-frame",
          },
        ],
        verdict: {
          failures: ["startup.first-frame:pty-first-frame: p95 1300.0ms exceeds 1200ms"],
        },
      },
      {
        layer: "renderer-specific",
        blocksProductDirection: true,
      },
    )

    expect(issues).toEqual([
      {
        id: "benchmark:startup.first-frame:pty-first-frame",
        title: "TUI benchmark failed: startup.first-frame",
        layer: "renderer-specific",
        status: "open",
        reproducible: true,
        source: "benchmark",
        criteriaFailures: ["startup.first-frame"],
        blocksProductDirection: true,
        notes: ["startup.first-frame:pty-first-frame: p95 1300.0ms exceeds 1200ms"],
      },
    ])
  })

  test("rejects benchmark failures that do not match result ids", () => {
    expect(() =>
      benchmarkIssues(
        {
          results: [{ id: "startup.first-frame:pty-first-frame", criterionID: "startup.first-frame" }],
          verdict: { failures: ["scroll.long-cjk-wrapped: 10.0fps is below 45fps"] },
        },
        {
          layer: "renderer-specific",
          blocksProductDirection: true,
        },
      ),
    ).toThrow("Benchmark failure did not match a result id")
  })

  test("matches the most specific benchmark result id when ids share prefixes", () => {
    const issues = benchmarkIssues(
      {
        results: [
          { id: "startup.first-frame", criterionID: "startup.first-frame" },
          { id: "startup.first-frame:pty-first-frame", criterionID: "startup.first-frame" },
        ],
        verdict: {
          failures: ["startup.first-frame:pty-first-frame: p95 1300.0ms exceeds 1200ms"],
        },
      },
      {
        layer: "renderer-specific",
        blocksProductDirection: true,
      },
    )

    expect(issues[0]?.id).toBe("benchmark:startup.first-frame:pty-first-frame")
  })

  test("validates evidence and benchmark report shape before summarizing", () => {
    expect(() => validateEvidenceFile({ issues: [{ id: "tui-1" }] })).toThrow("title")
    expect(() => validateBenchmarkReport({ results: [], verdict: { failures: [123] } })).toThrow(
      "verdict.failures",
    )

    expect(
      validateEvidenceFile({
        installOrBuildRiskAccepted: true,
        issues: [
          {
            id: "tui-1",
            title: "Resize crash",
            layer: "renderer-specific",
            status: "open",
            reproducible: true,
            source: "manual-repro",
          },
        ],
      }).issues?.[0]?.layer,
    ).toBe("renderer-specific")
  })
})
