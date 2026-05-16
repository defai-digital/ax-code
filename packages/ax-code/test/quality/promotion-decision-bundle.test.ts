import { describe, expect, test } from "bun:test"
import { QualityCalibrationModel } from "../../src/quality/calibration-model"
import { QualityPromotionDecisionBundle } from "../../src/quality/promotion-decision-bundle"
import { QualityPromotionEligibility } from "../../src/quality/promotion-eligibility"
import { QualityPromotionReleasePolicy } from "../../src/quality/promotion-release-policy"
import { QualityStabilityGuard } from "../../src/quality/stability-guard"

function benchmarkBundle(): QualityCalibrationModel.BenchmarkBundle {
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
      source: "decision-model-v1",
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
      source: "decision-model-v1",
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
      candidateSource: "decision-model-v1",
      overallStatus: "pass",
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

function stability(overallStatus: "pass" | "warn" | "fail"): QualityStabilityGuard.StabilitySummary {
  return {
    schemaVersion: 1,
    kind: "ax-code-quality-model-stability-summary",
    source: "decision-model-v1",
    evaluatedAt: "2026-04-20T12:00:00.000Z",
    latestRollbackAt: overallStatus === "pass" ? null : "2026-04-20T10:00:00.000Z",
    cooldownUntil: overallStatus === "fail" ? "2026-04-21T10:00:00.000Z" : null,
    cooldownHours: 24,
    repeatFailureWindowHours: 168,
    repeatFailureThreshold: 2,
    recentRollbackCount: overallStatus === "warn" ? 2 : 0,
    coolingWindowActive: overallStatus === "fail",
    escalationRequired: overallStatus === "warn",
    overallStatus,
    gates: [
      {
        name: overallStatus === "fail" ? "cooling-window" : "repeated-failures",
        status: overallStatus,
        detail: overallStatus === "fail" ? "cooldown detail" : "warning detail",
      },
    ],
  }
}

function eligibility(
  decision: "go" | "review" | "no_go",
  requiredOverride: "none" | "allow_warn" | "force",
): QualityPromotionEligibility.EligibilitySummary {
  return {
    schemaVersion: 1,
    kind: "ax-code-quality-promotion-eligibility",
    source: "decision-model-v1",
    evaluatedAt: "2026-04-20T12:00:00.000Z",
    benchmarkStatus: decision === "no_go" ? "fail" : "pass",
    stabilityStatus: decision === "review" ? "warn" : decision === "no_go" ? "fail" : "pass",
    decision,
    requiredOverride,
    currentActiveSource: "baseline-model-v1",
    lastPromotionAt: "2026-04-20T09:00:00.000Z",
    lastRollbackAt: decision === "go" ? null : "2026-04-20T10:00:00.000Z",
    reentryContext: null,
    remediation: null,
    history: {
      priorPromotions: 1,
      priorRollbacks: decision === "go" ? 0 : 1,
      recentRollbackCount: decision === "review" ? 2 : 0,
      coolingWindowActive: decision === "no_go",
      escalationRequired: decision === "review",
    },
    gates: [{ name: "benchmark-comparison", status: decision === "no_go" ? "fail" : "pass", detail: "ok" }],
  }
}

describe("QualityPromotionDecisionBundle", () => {
  test("builds a decision bundle and renders a report", () => {
    const releasePolicy = QualityPromotionReleasePolicy.defaults({
      watch: {
        minRecords: 25,
      },
    })
    const bundle = QualityPromotionDecisionBundle.build({
      benchmark: benchmarkBundle(),
      stability: stability("pass"),
      eligibility: eligibility("go", "none"),
      policy: {
        cooldownHours: 24,
        repeatFailureWindowHours: 168,
        repeatFailureThreshold: 2,
      },
      releasePolicySnapshot: {
        policy: releasePolicy,
        provenance: QualityPromotionReleasePolicy.PolicyProvenance.parse({
          policySource: "project",
          policyProjectID: "decision-project-1",
          compatibilityApprovalSource: null,
          resolvedAt: "2026-04-20T12:00:00.000Z",
          persistedScope: "project",
          persistedUpdatedAt: "2026-04-20T11:00:00.000Z",
          digest: QualityPromotionReleasePolicy.digest(releasePolicy),
        }),
      },
    })

    expect(bundle.source).toBe("decision-model-v1")
    expect(bundle.snapshot.currentActiveSource).toBe("baseline-model-v1")
    expect(bundle.releasePolicy?.provenance.policySource).toBe("project")
    expect(bundle.releasePolicy?.provenance.policyProjectID).toBe("decision-project-1")
    expect(bundle.releasePolicy?.policy.watch.minRecords).toBe(25)
    expect(bundle.approvalPolicySuggestion?.recommendation.workflow).toBe("review")
    expect(bundle.approvalPolicySuggestion?.recommendation.riskTier).toBe("standard")
    expect(bundle.approvalPolicySuggestion?.suggestedReentryPolicy.approvalConcentrationPreset).toBe("balanced")
    expect(bundle.approvalPolicySuggestion?.effectiveReentryPolicy?.approvalConcentrationPreset).toBe("reviewer-heavy")
    expect(bundle.approvalPolicySuggestion?.alignment?.overall).toBe(false)
    expect(bundle.approvalPolicySuggestion?.adoption.status).toBe("diverged")
    expect(bundle.approvalPolicySuggestion?.adoption.acceptedFields).toBe(0)
    expect(bundle.approvalPolicySuggestion?.adoption.differingFields).toBe(3)

    const report = QualityPromotionDecisionBundle.renderReport(bundle)
    expect(report).toContain("## ax-code quality promotion decision bundle")
    expect(report).toContain("- decision: go")
    expect(report).toContain("- release policy source: project")
    expect(report).toContain("- suggested concentration preset: balanced")
    expect(report).toContain("- suggestion aligned with effective policy: false")
    expect(report).toContain("- suggestion adoption status: diverged")
    expect(report).toContain("Approval policy adoption:")
  })

  test("reports drift when the current history snapshot changes", () => {
    const bundle = QualityPromotionDecisionBundle.build({
      benchmark: benchmarkBundle(),
      stability: stability("pass"),
      eligibility: eligibility("go", "none"),
    })

    const reasons = QualityPromotionDecisionBundle.driftReasons(bundle, {
      stability: stability("warn"),
      eligibility: {
        ...eligibility("review", "allow_warn"),
        currentActiveSource: "new-active-model-v2",
      },
    })

    expect(reasons.some((reason) => reason.includes("current active source changed"))).toBe(true)
    expect(reasons.some((reason) => reason.includes("eligibility decision changed"))).toBe(true)
  })
})
