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
        qa: ProbabilisticRollout.ReplayReadinessSummary.parse({
          schemaVersion: 1,
          kind: "ax-code-quality-replay-readiness-summary",
          workflow: "qa",
          sessionID: "ses_456",
          projectID: "proj_1",
          exportedAt: "2026-04-21T00:00:00.000Z",
          totalItems: 1,
          anchorItems: 1,
          evidenceItems: 0,
          toolSummaryCount: 1,
          labeledItems: 1,
          resolvedLabeledItems: 1,
          unresolvedLabeledItems: 0,
          missingLabels: 0,
          readyForBenchmark: true,
          overallStatus: "pass",
          nextAction: null,
          gates: [
            {
              name: "targeted-test-recommendation",
              status: "pass",
              detail: "prioritize these QA command(s): bun test test/auth.test.ts",
            },
          ],
        }),
      },
    } as any)

    expect(lines).toContain("  Quality Readiness")
    expect(lines).toContain(
      "  review: ready · benchmark ready · 2/2 resolved labels · next: Ready to benchmark the current replay export.",
    )
    expect(lines).toContain(
      "  qa: ready · benchmark ready · 1/1 resolved labels · first: bun test test/auth.test.ts · next: Ready to benchmark the current replay export.",
    )
  })

  test("renders latest structured review result when available", () => {
    const lines = RiskView.lines({
      id: "ses_review_result",
      title: "Review result session",
      assessment: {
        level: "MEDIUM",
        score: 45,
        readiness: "needs_review",
        confidence: 0.7,
        summary: "review needs changes",
        signals: {
          filesChanged: 2,
          linesChanged: 32,
          totalTools: 4,
          apiEndpointsAffected: 0,
          crossModule: false,
          securityRelated: false,
          validationState: "partial",
          diffState: "recorded",
        },
      },
      semantic: null,
      drivers: [],
      reviewResults: [
        {
          schemaVersion: 1,
          reviewId: "1111111111111111",
          workflow: "review",
          decision: "request_changes",
          recommendedDecision: "request_changes",
          summary: "Blocking review finding remains.",
          findingIds: ["2222222222222222"],
          verificationEnvelopeIds: ["3333333333333333"],
          counts: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0, INFO: 0, total: 1 },
          blockingFindingIds: ["2222222222222222"],
          missingVerification: false,
          createdAt: "2026-04-29T00:00:00.000Z",
          source: { tool: "review_complete", version: "4.x.x", runId: "ses_review_result" },
        },
      ],
    } as any)

    expect(lines).toContain("  Review Result")
    expect(lines).toContain("  request changes · 1 finding · 1 blocking · 1 verification envelope")
  })

  test("renders policy-failed review verification distinctly", () => {
    const lines = RiskView.lines({
      id: "ses_review_policy_failed",
      title: "Review policy failed session",
      assessment: {
        level: "MEDIUM",
        score: 45,
        readiness: "needs_review",
        confidence: 0.7,
        summary: "review needs verification",
        signals: {
          filesChanged: 2,
          linesChanged: 32,
          totalTools: 4,
          apiEndpointsAffected: 0,
          crossModule: false,
          securityRelated: false,
          validationState: "partial",
          diffState: "recorded",
        },
      },
      semantic: null,
      drivers: [],
      reviewResults: [
        {
          schemaVersion: 1,
          reviewId: "1111111111111111",
          workflow: "review",
          decision: "needs_verification",
          recommendedDecision: "needs_verification",
          summary: "Required test check was skipped.",
          findingIds: [],
          verificationEnvelopeIds: ["3333333333333333"],
          counts: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0, total: 0 },
          blockingFindingIds: [],
          missingVerification: true,
          verificationPolicyFailed: true,
          createdAt: "2026-04-29T00:00:00.000Z",
          source: { tool: "review_complete", version: "4.x.x", runId: "ses_review_policy_failed" },
        },
      ],
    } as any)

    expect(lines).toContain("  needs verification · 0 findings · 0 blocking · verification policy failed")
  })

  test("renders decision hint evidence without dumping unbounded detail", () => {
    const lines = RiskView.lines({
      id: "ses_decision_hints",
      title: "Decision hint session",
      assessment: {
        level: "MEDIUM",
        score: 45,
        readiness: "needs_review",
        confidence: 0.7,
        summary: "review loop needs completion",
        signals: {
          filesChanged: 1,
          linesChanged: 8,
          totalTools: 3,
          apiEndpointsAffected: 0,
          crossModule: false,
          securityRelated: false,
          validationState: "partial",
          diffState: "recorded",
        },
      },
      semantic: null,
      drivers: [],
      decisionHints: {
        source: "replay",
        readiness: "needs_validation",
        actionCount: 3,
        hintCount: 1,
        hints: [
          {
            id: "missing-review-completion",
            category: "missing_review_completion",
            confidence: 0.82,
            title: "Complete the structured review result",
            body: "Run review_complete before finalizing the review.",
            evidence: [
              "review verification tool: verify_project",
              "review findings: 1",
              "review verification results: 1",
              "extra evidence",
            ],
          },
        ],
      },
    } as any)

    expect(lines).toContain("  Decision Hints")
    expect(lines).toContain(
      "  - Complete the structured review result (82%): Run review_complete before finalizing the review.",
    )
    expect(lines).toContain("    evidence: review verification tool: verify_project")
    expect(lines).toContain("    evidence: review findings: 1")
    expect(lines).toContain("    evidence: review verification results: 1")
    expect(lines).toContain("    evidence: +1 more")
    expect(lines).not.toContain("    evidence: extra evidence")
  })

  test("normalizes stale next-action wording for replay-readiness states", () => {
    const lines = RiskView.lines({
      id: "ses_789",
      title: "Replay readiness session",
      assessment: {
        level: "MEDIUM",
        score: 35,
        readiness: "needs_review",
        confidence: 0.71,
        summary: "replay needs refresh",
        signals: {
          filesChanged: 1,
          linesChanged: 12,
          totalTools: 1,
          apiEndpointsAffected: 0,
          crossModule: false,
          securityRelated: false,
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
          sessionID: "ses_789",
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
          readyForBenchmark: false,
          overallStatus: "warn",
          nextAction: "Finish label coverage for the remaining exported artifacts.",
          gates: [
            {
              name: "benchmark-readiness",
              status: "warn",
              detail: "refresh review replay evidence before benchmarking",
            },
          ],
        }),
        debug: null,
        qa: null,
      },
    } as any)

    expect(lines).toContain(
      "  review: not ready · label coverage complete · 2/2 resolved labels · next: Check review replay readiness gates before benchmarking.",
    )
    expect(lines.join("\n")).not.toContain("next: Finish label coverage for the remaining exported artifacts.")
  })
})
