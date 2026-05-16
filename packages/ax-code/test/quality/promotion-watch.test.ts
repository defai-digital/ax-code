import { describe, expect, test } from "bun:test"
import { ProbabilisticRollout } from "../../src/quality/probabilistic-rollout"
import { QualityPromotionReleasePolicy } from "../../src/quality/promotion-release-policy"
import { QualityPromotionWatch } from "../../src/quality/promotion-watch"

function shadowRecord(input: {
  artifactID: string
  sessionID: string
  createdAt: string
  capturedAt: string
  candidateAvailable: boolean
  predictionChanged?: boolean
  abstentionChanged?: boolean
  confidenceDelta?: number | null
}) {
  return {
    schemaVersion: 1,
    kind: "ax-code-quality-shadow-record",
    artifactID: input.artifactID,
    sessionID: input.sessionID,
    workflow: "review",
    artifactKind: "review_run",
    title: input.artifactID,
    createdAt: input.createdAt,
    capturedAt: input.capturedAt,
    baseline: {
      source: "Risk.assess",
      available: true,
      confidence: 0.5,
      score: 50,
      readiness: "ready",
      rank: null,
      threshold: 0.5,
      abstainBelow: null,
      predictedPositive: true,
      abstained: false,
    },
    candidate: {
      source: "watch-model-v1",
      available: input.candidateAvailable,
      confidence: input.candidateAvailable ? 0.6 : null,
      score: input.candidateAvailable ? 60 : null,
      readiness: "ready",
      rank: null,
      threshold: 0.5,
      abstainBelow: null,
      predictedPositive: input.candidateAvailable ? true : null,
      abstained: !input.candidateAvailable,
    },
    disagreement: {
      candidateMissing: !input.candidateAvailable,
      predictionChanged: input.predictionChanged ?? false,
      abstentionChanged: input.abstentionChanged ?? false,
      confidenceDelta: input.confidenceDelta ?? 0.1,
      rankDelta: null,
    },
  } satisfies ProbabilisticRollout.ShadowRecord
}

describe("QualityPromotionWatch", () => {
  test("uses only post-promotion records inside the fixed watch window", () => {
    const records: ProbabilisticRollout.ShadowRecord[] = [
      shadowRecord({
        artifactID: "before",
        sessionID: "ses_1",
        createdAt: "2026-04-20T00:00:00.000Z",
        capturedAt: "2026-04-20T00:00:00.000Z",
        candidateAvailable: true,
      }),
      shadowRecord({
        artifactID: "after-1",
        sessionID: "ses_2",
        createdAt: "2026-04-20T01:00:00.000Z",
        capturedAt: "2026-04-20T01:00:00.000Z",
        candidateAvailable: true,
      }),
      shadowRecord({
        artifactID: "after-2",
        sessionID: "ses_3",
        createdAt: "2026-04-20T02:00:00.000Z",
        capturedAt: "2026-04-20T02:00:00.000Z",
        candidateAvailable: true,
      }),
    ]

    const summary = QualityPromotionWatch.summarize({
      records,
      source: "watch-model-v1",
      promotedAt: "2026-04-20T00:30:00.000Z",
      minRecords: 2,
      maxRecords: 10,
      releasePolicy: {
        policy: QualityPromotionReleasePolicy.defaults({
          watch: {
            minRecords: 2,
          },
        }),
        provenance: QualityPromotionReleasePolicy.PolicyProvenance.parse({
          policySource: "project",
          policyProjectID: "watch-project-1",
          compatibilityApprovalSource: null,
          resolvedAt: "2026-04-20T00:30:00.000Z",
          persistedScope: "project",
          persistedUpdatedAt: "2026-04-20T00:00:00.000Z",
          digest: QualityPromotionReleasePolicy.digest(
            QualityPromotionReleasePolicy.defaults({
              watch: {
                minRecords: 2,
              },
            }),
          ),
        }),
      },
    })

    expect(summary.window.totalRecords).toBe(2)
    expect(summary.window.sessionsCovered).toBe(2)
    expect(summary.overallStatus).toBe("pass")
    expect(summary.releasePolicy?.provenance.policySource).toBe("project")

    const report = QualityPromotionWatch.renderWatchReport(summary)
    expect(report).toContain("## ax-code quality promotion watch")
    expect(report).toContain("- overall status: pass")
    expect(report).toContain("- release policy source: project")
  })

  test("fails the watch when post-promotion candidate coverage is missing", () => {
    const records: ProbabilisticRollout.ShadowRecord[] = [
      shadowRecord({
        artifactID: "after-missing",
        sessionID: "ses_4",
        createdAt: "2026-04-20T03:00:00.000Z",
        capturedAt: "2026-04-20T03:00:00.000Z",
        candidateAvailable: false,
        abstentionChanged: true,
        confidenceDelta: null,
      }),
    ]

    const summary = QualityPromotionWatch.summarize({
      records,
      source: "watch-model-v1",
      promotedAt: "2026-04-20T00:30:00.000Z",
      minRecords: 1,
    })

    expect(summary.shadow.missingCandidateItems).toBe(1)
    expect(summary.overallStatus).toBe("fail")
    expect(summary.gates.find((gate) => gate.name === "candidate-coverage")?.status).toBe("fail")
  })

  test("uses release policy watch thresholds instead of fixed defaults", () => {
    const records: ProbabilisticRollout.ShadowRecord[] = [
      shadowRecord({
        artifactID: "threshold-1",
        sessionID: "ses_1",
        createdAt: "2026-04-20T03:00:00.000Z",
        capturedAt: "2026-04-20T03:00:00.000Z",
        candidateAvailable: true,
        abstentionChanged: true,
      }),
      shadowRecord({
        artifactID: "threshold-2",
        sessionID: "ses_2",
        createdAt: "2026-04-20T03:01:00.000Z",
        capturedAt: "2026-04-20T03:01:00.000Z",
        candidateAvailable: true,
      }),
      shadowRecord({
        artifactID: "threshold-3",
        sessionID: "ses_3",
        createdAt: "2026-04-20T03:02:00.000Z",
        capturedAt: "2026-04-20T03:02:00.000Z",
        candidateAvailable: true,
      }),
      shadowRecord({
        artifactID: "threshold-4",
        sessionID: "ses_4",
        createdAt: "2026-04-20T03:03:00.000Z",
        capturedAt: "2026-04-20T03:03:00.000Z",
        candidateAvailable: true,
      }),
      shadowRecord({
        artifactID: "threshold-5",
        sessionID: "ses_5",
        createdAt: "2026-04-20T03:04:00.000Z",
        capturedAt: "2026-04-20T03:04:00.000Z",
        candidateAvailable: true,
      }),
    ]

    const defaultSummary = QualityPromotionWatch.summarize({
      records,
      source: "watch-model-v1",
      promotedAt: "2026-04-20T00:30:00.000Z",
      minRecords: 5,
    })
    expect(defaultSummary.gates.find((gate) => gate.name === "abstention-drift")?.status).toBe("warn")

    const policySummary = QualityPromotionWatch.summarize({
      records,
      source: "watch-model-v1",
      promotedAt: "2026-04-20T00:30:00.000Z",
      policy: {
        minRecords: 5,
        abstentionWarnRate: 0.25,
        abstentionFailRate: 0.5,
      },
    })
    expect(policySummary.gates.find((gate) => gate.name === "abstention-drift")?.status).toBe("pass")
    expect(policySummary.overallStatus).toBe("pass")
  })
})
