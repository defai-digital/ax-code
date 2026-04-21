import { describe, expect, test } from "bun:test"
import { RiskView } from "../../src/cli/cmd/risk"
import { ProbabilisticRollout } from "../../src/quality/probabilistic-rollout"

describe("RiskView.lines", () => {
  test("uses confidence wording instead of trust", () => {
    const lines = RiskView.lines({
      id: "ses_123",
      title: "Demo session",
      assessment: {
        level: "LOW",
        score: 12,
        readiness: "ready",
        confidence: 0.87,
        summary: "minimal change",
        signals: {
          filesChanged: 1,
          linesChanged: 10,
          totalTools: 2,
          apiEndpointsAffected: 0,
          crossModule: false,
          securityRelated: false,
          validationState: "passed",
          diffState: "clean",
        },
      },
      semantic: null,
      drivers: [],
    } as any)

    expect(lines).toContain("  Confidence: 87%")
    expect(lines.join("\n")).not.toContain("  Trust:")
  })

  test("renders quality readiness when replay summaries are available", () => {
    const lines = RiskView.lines({
      id: "ses_456",
      title: "Replay ready session",
      assessment: {
        level: "MEDIUM",
        score: 42,
        readiness: "needs_review",
        confidence: 0.66,
        summary: "review findings need attention",
        signals: {
          filesChanged: 2,
          linesChanged: 18,
          totalTools: 1,
          apiEndpointsAffected: 0,
          crossModule: false,
          securityRelated: true,
          validationState: "partial",
          diffState: "recorded",
        },
      },
      semantic: null,
      drivers: [],
      quality: {
        review: ProbabilisticRollout.ReplayReadinessSummary.parse({
          schemaVersion: 1,
          kind: "ax-code-quality-replay-readiness-summary",
          workflow: "review",
          sessionID: "ses_456",
          projectID: "proj_1",
          exportedAt: "2026-04-21T00:00:00.000Z",
          totalItems: 2,
          anchorItems: 1,
          evidenceItems: 1,
          toolSummaryCount: 1,
          labeledItems: 2,
          resolvedLabeledItems: 2,
          unresolvedLabeledItems: 0,
          missingLabels: 0,
          readyForBenchmark: true,
          overallStatus: "pass",
          nextAction: null,
          gates: [
            {
              name: "benchmark-readiness",
              status: "pass",
              detail: "2 resolved labels available",
            },
          ],
        }),
        debug: null,
      },
    } as any)

    expect(lines).toContain("  Quality Readiness")
    expect(lines).toContain("  review: pass · benchmark ready · 2/2 resolved labels")
  })
})
