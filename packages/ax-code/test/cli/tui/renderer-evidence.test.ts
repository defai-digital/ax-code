import { describe, expect, test } from "bun:test"
import { summarizeTuiRendererEvidence, type TuiRendererIssueEvidence } from "../../../src/cli/cmd/tui/renderer-evidence"

const baseIssue: TuiRendererIssueEvidence = {
  id: "tui-001",
  title: "Prompt loses focus after resize",
  layer: "renderer-specific",
  status: "open",
  reproducible: true,
  source: "manual-repro",
  criteriaFailures: ["terminal.resize-stability"],
}

describe("tui renderer evidence", () => {
  test("retains OpenTUI when active issues are not reproducible", () => {
    const summary = summarizeTuiRendererEvidence({
      issues: [{ ...baseIssue, status: "needs-repro", reproducible: false }],
    })

    expect(summary).toMatchObject({
      total: 1,
      active: 1,
      reproducible: 0,
      rendererSpecific: 0,
      criteriaFailures: [],
      decision: { action: "retain-opentui" },
    })
    expect(summary.needsRepro).toEqual(["tui-001"])
  })

  test("routes reproducible non-renderer failures to product-layer work", () => {
    const summary = summarizeTuiRendererEvidence({
      issues: [
        {
          ...baseIssue,
          layer: "integration-layer",
          criteriaFailures: ["input.keypress-echo"],
          blocksProductDirection: true,
        },
      ],
      installOrBuildRiskAccepted: true,
      offlinePackagingDeterministic: true,
    })

    expect(summary.byLayer["integration-layer"]).toBe(1)
    expect(summary.decision.action).toBe("fix-product-layer")
  })

  test("proposes native core only for blocking renderer-specific failures with accepted delivery gates", () => {
    const summary = summarizeTuiRendererEvidence({
      issues: [{ ...baseIssue, blocksProductDirection: true }],
      installOrBuildRiskAccepted: true,
      offlinePackagingDeterministic: true,
    })

    expect(summary).toMatchObject({
      reproducible: 1,
      rendererSpecific: 1,
      criteriaFailures: ["terminal.resize-stability"],
      decision: { action: "propose-rust-native-core", requiresAdr: true },
    })
  })

  test("does not propose native core when reproducible failures are mixed across layers", () => {
    const summary = summarizeTuiRendererEvidence({
      issues: [
        { ...baseIssue, blocksProductDirection: true },
        {
          ...baseIssue,
          id: "tui-002",
          layer: "product-layer",
          criteriaFailures: ["transcript.large-append"],
          blocksProductDirection: true,
        },
      ],
      installOrBuildRiskAccepted: true,
      offlinePackagingDeterministic: true,
    })

    expect(summary.criteriaFailures).toEqual(["terminal.resize-stability", "transcript.large-append"])
    expect(summary.decision.action).toBe("fix-product-layer")
  })

  test("deduplicates criteria and ignores mitigated issues", () => {
    const summary = summarizeTuiRendererEvidence({
      issues: [
        { ...baseIssue, id: "tui-001", criteriaFailures: ["input.paste-echo", "input.paste-echo"] },
        { ...baseIssue, id: "tui-002", status: "mitigated", criteriaFailures: ["terminal.resize-stability"] },
      ],
    })

    expect(summary.active).toBe(1)
    expect(summary.criteriaFailures).toEqual(["input.paste-echo"])
  })
})
