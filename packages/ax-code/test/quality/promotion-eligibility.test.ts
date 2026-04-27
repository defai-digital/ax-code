import { describe, expect, test } from "bun:test"
import { QualityCalibrationModel } from "../../src/quality/calibration-model"
import { QualityPromotionEligibility } from "../../src/quality/promotion-eligibility"
import { QualityPromotionReleasePolicy } from "../../src/quality/promotion-release-policy"
import { QualityReentryContext } from "../../src/quality/reentry-context"
import { QualityReentryRemediation } from "../../src/quality/reentry-remediation"
import { QualityStabilityGuard } from "../../src/quality/stability-guard"

function benchmarkBundle(status: "pass" | "warn" | "fail"): QualityCalibrationModel.BenchmarkBundle {
  return {
    schemaVersion: 1,
    kind: "ax-code-quality-benchmark-bundle",
    split: {
      ratio: 0.7,
      trainSessionIDs: ["ses_train_1", "ses_train_2"],
      evalSessionIDs: ["ses_eval_1"],
    },
    model: {
      schemaVersion: 1,
      kind: "ax-code-quality-calibration-model",
      source: "eligibility-model-v1",
      trainedAt: "2026-04-20T00:00:00.000Z",
      globalPrior: 0.55,
      laplaceAlpha: 2,
      requestedBinCount: 1,
      minBinCount: 1,
      training: {
        sessionIDs: ["ses_train_1", "ses_train_2"],
        labeledItems: 4,
        positives: 2,
        negatives: 2,
      },
      groups: [
        {
          workflow: "review",
          artifactKind: "review_run",
          totalCount: 4,
          positives: 2,
          negatives: 2,
          prior: 0.5,
          bins: [
            {
              start: 0,
              end: 1,
              count: 4,
              positives: 2,
              negatives: 2,
              avgBaselineConfidence: 0.5,
              empiricalRate: 0.5,
              smoothedRate: 0.55,
            },
          ],
        },
      ],
    },
    baselineSummary: {
      schemaVersion: 1,
      kind: "ax-code-quality-calibration-summary",
      source: "baseline",
      threshold: 0.5,
      abstainBelow: null,
      totalItems: 1,
      scoredItems: 1,
      missingPredictionItems: 0,
      labeledItems: 1,
      consideredItems: 1,
      abstainedItems: 0,
      positives: 1,
      negatives: 0,
      precision: 1,
      recall: 1,
      falsePositiveRate: null,
      falseNegativeRate: 0,
      precisionAt1: 1,
      precisionAt3: 1,
      calibrationError: 0,
      bins: [],
    },
    candidateSummary: {
      schemaVersion: 1,
      kind: "ax-code-quality-calibration-summary",
      source: "eligibility-model-v1",
      threshold: 0.5,
      abstainBelow: null,
      totalItems: 1,
      scoredItems: 1,
      missingPredictionItems: 0,
      labeledItems: 1,
      consideredItems: 1,
      abstainedItems: 0,
      positives: 1,
      negatives: 0,
      precision: 1,
      recall: 1,
      falsePositiveRate: null,
      falseNegativeRate: 0,
      precisionAt1: 1,
      precisionAt3: 1,
      calibrationError: 0,
      bins: [],
    },
    comparison: {
      schemaVersion: 1,
      kind: "ax-code-quality-calibration-comparison",
      baselineSource: "baseline",
      candidateSource: "eligibility-model-v1",
      overallStatus: status,
      dataset: {
        baselineTotalItems: 1,
        candidateTotalItems: 1,
        baselineScoredItems: 1,
        candidateScoredItems: 1,
        baselineLabeledItems: 1,
        candidateLabeledItems: 1,
        baselineMissingPredictionItems: 0,
        candidateMissingPredictionItems: 0,
      },
      metrics: {
        precision: {
          baseline: 1,
          candidate: 1,
          delta: 0,
          direction: "higher_is_better",
          improvement: false,
          regression: false,
        },
        recall: {
          baseline: 1,
          candidate: 1,
          delta: 0,
          direction: "higher_is_better",
          improvement: false,
          regression: false,
        },
        falsePositiveRate: {
          baseline: null,
          candidate: null,
          delta: null,
          direction: "lower_is_better",
          improvement: false,
          regression: false,
        },
        falseNegativeRate: {
          baseline: 0,
          candidate: 0,
          delta: 0,
          direction: "lower_is_better",
          improvement: false,
          regression: false,
        },
        precisionAt1: {
          baseline: 1,
          candidate: 1,
          delta: 0,
          direction: "higher_is_better",
          improvement: false,
          regression: false,
        },
        precisionAt3: {
          baseline: 1,
          candidate: 1,
          delta: 0,
          direction: "higher_is_better",
          improvement: false,
          regression: false,
        },
        calibrationError: {
          baseline: 0,
          candidate: 0,
          delta: 0,
          direction: "lower_is_better",
          improvement: false,
          regression: false,
        },
      },
      gates: [{ name: "dataset-consistency", status: "pass", detail: "ok" }],
    },
  }
}

function stabilitySummary(status: "pass" | "warn" | "fail"): QualityStabilityGuard.StabilitySummary {
  return {
    schemaVersion: 1,
    kind: "ax-code-quality-model-stability-summary",
    source: "eligibility-model-v1",
    evaluatedAt: "2026-04-20T12:00:00.000Z",
    latestRollbackAt: status === "pass" ? null : "2026-04-20T10:00:00.000Z",
    cooldownUntil: status === "fail" ? "2026-04-21T10:00:00.000Z" : null,
    cooldownHours: 24,
    repeatFailureWindowHours: 168,
    repeatFailureThreshold: 2,
    recentRollbackCount: status === "warn" ? 2 : status === "fail" ? 1 : 0,
    coolingWindowActive: status === "fail",
    escalationRequired: status === "warn",
    overallStatus: status,
    gates: [
      {
        name: status === "fail" ? "cooling-window" : "repeated-failures",
        status,
        detail:
          status === "fail"
            ? "latest rollback=2026-04-20T10:00:00.000Z; cooldown until=2026-04-21T10:00:00.000Z"
            : "2 rollback(s) in trailing 168h window; threshold=2",
      },
    ],
  }
}

describe("QualityPromotionEligibility", () => {
  test("returns go when benchmark and stability both pass", () => {
    const summary = QualityPromotionEligibility.summarize({
      bundle: benchmarkBundle("pass"),
      stability: stabilitySummary("pass"),
      currentActiveSource: "baseline-model-v1",
      priorPromotions: 1,
      priorRollbacks: 0,
    })

    expect(summary.decision).toBe("go")
    expect(summary.requiredOverride).toBe("none")

    const report = QualityPromotionEligibility.renderReport(summary)
    expect(report).toContain("## ax-code quality promotion eligibility")
    expect(report).toContain("- decision: go")
  })

  test("returns review when only warn-level gates are present", () => {
    const summary = QualityPromotionEligibility.summarize({
      bundle: benchmarkBundle("pass"),
      stability: stabilitySummary("warn"),
    })

    expect(summary.decision).toBe("review")
    expect(summary.requiredOverride).toBe("allow_warn")
    expect(QualityPromotionEligibility.reviewReason(summary)).toContain("stability:repeated-failures")
  })

  test("returns no_go when a fail gate is present", () => {
    const benchmarkFail = QualityPromotionEligibility.summarize({
      bundle: benchmarkBundle("fail"),
      stability: stabilitySummary("pass"),
    })
    expect(benchmarkFail.decision).toBe("no_go")
    expect(QualityPromotionEligibility.blockingReason(benchmarkFail)).toBe("comparison status is fail")

    const cooldownFail = QualityPromotionEligibility.summarize({
      bundle: benchmarkBundle("pass"),
      stability: stabilitySummary("fail"),
    })
    expect(cooldownFail.decision).toBe("no_go")
    expect(QualityPromotionEligibility.blockingReason(cooldownFail)).toContain("cooldown until")
  })

  test("returns review when the latest rollback used the same release policy digest", () => {
    const releasePolicy = QualityPromotionReleasePolicy.defaults()
    const reentryContext = QualityReentryContext.ContextArtifact.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-model-reentry-context",
      contextID: "rollback-ctx-1",
      source: "eligibility-model-v1",
      rollbackID: "rollback-1",
      promotionID: "promotion-1",
      createdAt: "2026-04-20T12:30:00.000Z",
      promotedAt: "2026-04-20T10:00:00.000Z",
      rolledBackAt: "2026-04-20T11:00:00.000Z",
      previousActiveSource: "baseline-model-v1",
      rollbackTargetSource: "baseline-model-v1",
      watch: {
        overallStatus: "fail",
        releasePolicySource: "project",
        releasePolicyDigest: QualityPromotionReleasePolicy.digest(releasePolicy),
        totalRecords: 8,
        sessionsCovered: 6,
        gates: [
          {
            name: "candidate-coverage",
            status: "fail",
            detail: "coverage missing",
          },
        ],
      },
      stability: {
        cooldownUntil: "2026-04-20T11:30:00.000Z",
        repeatFailureWindowHours: 168,
        repeatFailureThreshold: 2,
        recentRollbackCount: 1,
      },
    })

    const summary = QualityPromotionEligibility.summarize({
      bundle: benchmarkBundle("pass"),
      stability: stabilitySummary("pass"),
      reentryContext,
      currentReleasePolicyDigest: QualityPromotionReleasePolicy.digest(releasePolicy),
    })

    expect(summary.decision).toBe("review")
    expect(summary.requiredOverride).toBe("allow_warn")
    expect(summary.reentryContext?.sameReleasePolicyAsCurrent).toBe(true)
    expect(summary.remediation).toBeNull()
    expect(QualityPromotionEligibility.reviewReason(summary)).toContain("reentry:missing-remediation")
    expect(QualityPromotionEligibility.reviewReason(summary)).toContain("reentry:same-release-policy")
  })

  test("keeps same-policy reentry in review when remediation exists, and records remediation provenance", () => {
    const releasePolicy = QualityPromotionReleasePolicy.defaults()
    const reentryContext = QualityReentryContext.ContextArtifact.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-model-reentry-context",
      contextID: "rollback-ctx-2",
      source: "eligibility-model-v1",
      rollbackID: "rollback-2",
      promotionID: "promotion-2",
      createdAt: "2026-04-20T12:30:00.000Z",
      promotedAt: "2026-04-20T10:00:00.000Z",
      rolledBackAt: "2026-04-20T11:00:00.000Z",
      previousActiveSource: "baseline-model-v1",
      rollbackTargetSource: "baseline-model-v1",
      watch: {
        overallStatus: "fail",
        releasePolicySource: "project",
        releasePolicyDigest: QualityPromotionReleasePolicy.digest(releasePolicy),
        totalRecords: 8,
        sessionsCovered: 6,
        gates: [
          {
            name: "candidate-coverage",
            status: "fail",
            detail: "coverage missing",
          },
        ],
      },
      stability: {
        cooldownUntil: "2026-04-20T11:30:00.000Z",
        repeatFailureWindowHours: 168,
        repeatFailureThreshold: 2,
        recentRollbackCount: 1,
      },
    })
    const remediation = QualityReentryRemediation.RemediationArtifact.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-model-reentry-remediation",
      remediationID: "rem-1",
      source: "eligibility-model-v1",
      contextID: "rollback-ctx-2",
      rollbackID: "rollback-2",
      rolledBackAt: "2026-04-20T11:00:00.000Z",
      createdAt: "2026-04-20T12:10:00.000Z",
      author: "staff@example.com",
      summary: "Added stronger validation coverage for the candidate path.",
      evidence: [
        {
          kind: "validation",
          detail: "Executed deterministic replay and confirmed candidate coverage recovered.",
        },
      ],
      currentReleasePolicyDigest: QualityPromotionReleasePolicy.digest(releasePolicy),
    })

    const summary = QualityPromotionEligibility.summarize({
      bundle: benchmarkBundle("pass"),
      stability: stabilitySummary("pass"),
      reentryContext,
      remediation,
      currentReleasePolicyDigest: QualityPromotionReleasePolicy.digest(releasePolicy),
    })

    expect(summary.decision).toBe("review")
    expect(summary.requiredOverride).toBe("allow_warn")
    expect(summary.remediation?.remediationID).toBe("rem-1")
    expect(summary.remediation?.matchesCurrentReleasePolicyDigest).toBe(true)
    expect(QualityPromotionEligibility.reviewReason(summary)).toContain("reentry:same-release-policy")
    expect(QualityPromotionEligibility.reviewReason(summary)).toContain("remediation=rem-1")
  })
})
