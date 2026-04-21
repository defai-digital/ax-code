import { describe, expect, test } from "bun:test"
import { QualityPromotionApproval } from "../../src/quality/promotion-approval"
import { QualityPromotionDecisionBundle } from "../../src/quality/promotion-decision-bundle"
import { QualityPromotionEligibility } from "../../src/quality/promotion-eligibility"
import { QualityPromotionReleasePolicy } from "../../src/quality/promotion-release-policy"
import { QualityStabilityGuard } from "../../src/quality/stability-guard"
import { QualityCalibrationModel } from "../../src/quality/calibration-model"
import { Storage } from "../../src/storage/storage"

function decisionBundle(): QualityPromotionDecisionBundle.DecisionBundle {
  const benchmark: QualityCalibrationModel.BenchmarkBundle = {
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
      source: "approval-model-v1",
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
      source: "approval-model-v1",
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
      candidateSource: "approval-model-v1",
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
        precision: { baseline: 1, candidate: 1, delta: 0, direction: "higher_is_better", improvement: false, regression: false },
        recall: { baseline: 1, candidate: 1, delta: 0, direction: "higher_is_better", improvement: false, regression: false },
        falsePositiveRate: { baseline: null, candidate: null, delta: null, direction: "lower_is_better", improvement: false, regression: false },
        falseNegativeRate: { baseline: 0, candidate: 0, delta: 0, direction: "lower_is_better", improvement: false, regression: false },
        precisionAt1: { baseline: 1, candidate: 1, delta: 0, direction: "higher_is_better", improvement: false, regression: false },
        precisionAt3: { baseline: 1, candidate: 1, delta: 0, direction: "higher_is_better", improvement: false, regression: false },
        calibrationError: { baseline: 0, candidate: 0, delta: 0, direction: "lower_is_better", improvement: false, regression: false },
      },
      gates: [{ name: "dataset-consistency", status: "pass", detail: "ok" }],
    },
  }

  return QualityPromotionDecisionBundle.DecisionBundle.parse({
    schemaVersion: 1,
    kind: "ax-code-quality-promotion-decision-bundle",
    createdAt: "2026-04-20T12:00:00.000Z",
    source: "approval-model-v1",
    policy: {
      cooldownHours: 24,
      repeatFailureWindowHours: 168,
      repeatFailureThreshold: 2,
    },
    releasePolicy: {
      policy: QualityPromotionReleasePolicy.defaults({
        watch: {
          minRecords: 30,
        },
      }),
      provenance: QualityPromotionReleasePolicy.PolicyProvenance.parse({
        policySource: "project",
        policyProjectID: "approval-project-1",
        compatibilityApprovalSource: null,
        resolvedAt: "2026-04-20T12:00:00.000Z",
        persistedScope: "project",
        persistedUpdatedAt: "2026-04-20T11:00:00.000Z",
        digest: QualityPromotionReleasePolicy.digest(
          QualityPromotionReleasePolicy.defaults({
            watch: {
              minRecords: 30,
            },
          }),
        ),
      }),
    },
    benchmark,
    stability: {
      schemaVersion: 1,
      kind: "ax-code-quality-model-stability-summary",
      source: "approval-model-v1",
      evaluatedAt: "2026-04-20T12:00:00.000Z",
      latestRollbackAt: null,
      cooldownUntil: null,
      cooldownHours: 24,
      repeatFailureWindowHours: 168,
      repeatFailureThreshold: 2,
      recentRollbackCount: 0,
      coolingWindowActive: false,
      escalationRequired: false,
      overallStatus: "pass",
      gates: [{ name: "cooling-window", status: "pass", detail: "no prior rollback recorded" }],
    } satisfies QualityStabilityGuard.StabilitySummary,
    eligibility: {
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-eligibility",
      source: "approval-model-v1",
      evaluatedAt: "2026-04-20T12:00:00.000Z",
      benchmarkStatus: "pass",
      stabilityStatus: "pass",
      decision: "go",
      requiredOverride: "none",
      currentActiveSource: "baseline-model-v1",
      lastPromotionAt: "2026-04-20T10:00:00.000Z",
      lastRollbackAt: null,
      reentryContext: null,
      remediation: null,
      history: {
        priorPromotions: 1,
        priorRollbacks: 0,
        recentRollbackCount: 0,
        coolingWindowActive: false,
        escalationRequired: false,
      },
      gates: [{ name: "benchmark-comparison", status: "pass", detail: "ok" }],
    } satisfies QualityPromotionEligibility.EligibilitySummary,
    snapshot: {
      currentActiveSource: "baseline-model-v1",
      lastPromotionAt: "2026-04-20T10:00:00.000Z",
      lastRollbackAt: null,
      priorPromotions: 1,
      priorRollbacks: 0,
    },
  })
}

async function clearApprovals() {
  const keys = await Storage.list(["quality_model_approval"])
  for (const parts of keys) {
    await Storage.remove(parts)
  }
}

describe("QualityPromotionApproval", () => {
  test("creates, persists, verifies, and lists approval artifacts", async () => {
    const bundle = decisionBundle()
    await clearApprovals()
    try {
      const approval = QualityPromotionApproval.create({
        bundle,
        approver: "reviewer@example.com",
        role: "engineering-manager",
        team: "quality-platform",
        reportingChain: "eng/platform/director-a",
        rationale: "Reviewed benchmark, eligibility, and rollback history.",
      })
      expect(QualityPromotionApproval.verify(bundle, approval)).toEqual([])

      await QualityPromotionApproval.append(approval)
      await QualityPromotionApproval.assertPersisted(approval)

      const listed = await QualityPromotionApproval.list(bundle.source)
      expect(listed).toHaveLength(1)
      expect(listed[0]?.approver).toBe("reviewer@example.com")
      expect(listed[0]?.team).toBe("quality-platform")
      expect(listed[0]?.reportingChain).toBe("eng/platform/director-a")
      expect(listed[0]?.releasePolicy?.provenance.policySource).toBe("project")
      expect(listed[0]?.approvalPolicySuggestion?.recommendation.workflow).toBe("review")
      expect(listed[0]?.approvalPolicySuggestion?.suggestedReentryPolicy.approvalConcentrationPreset).toBe("balanced")
      expect(listed[0]?.approvalPolicySuggestion?.adoption.status).toBe("diverged")

      const report = QualityPromotionApproval.renderReport(approval)
      expect(report).toContain("## ax-code quality promotion approval")
      expect(report).toContain("- disposition: approved")
      expect(report).toContain("- reporting chain: eng/platform/director-a")
      expect(report).toContain("- release policy source: project")
      expect(report).toContain("- suggested concentration preset: balanced")
      expect(report).toContain("- suggestion adoption status: diverged")
    } finally {
      await clearApprovals()
    }
  })

  test("reports verification failures when the decision bundle does not match", () => {
    const bundle = decisionBundle()
    const approval = QualityPromotionApproval.create({
      bundle,
      approver: "reviewer@example.com",
    })
    const modified = QualityPromotionDecisionBundle.DecisionBundle.parse({
      ...bundle,
      eligibility: {
        ...bundle.eligibility,
        decision: "review",
        requiredOverride: "allow_warn",
      },
    })

    const reasons = QualityPromotionApproval.verify(modified, approval)
    expect(reasons.some((reason) => reason.includes("eligibility decision mismatch"))).toBe(true)
  })

  test("reports release policy verification failures when the approval snapshot is tampered", () => {
    const bundle = decisionBundle()
    const approval = QualityPromotionApproval.create({
      bundle,
      approver: "reviewer@example.com",
    })
    const tampered = QualityPromotionApproval.ApprovalArtifact.parse({
      ...approval,
      releasePolicy: {
        ...approval.releasePolicy,
        provenance: {
          ...approval.releasePolicy?.provenance,
          digest: "tampered-digest",
        },
      },
    })

    const reasons = QualityPromotionApproval.verify(bundle, tampered)
    expect(reasons.some((reason) => reason.includes("release policy digest mismatch"))).toBe(true)
  })

  test("reports approval policy suggestion verification failures when the approval snapshot is tampered", () => {
    const bundle = decisionBundle()
    const approval = QualityPromotionApproval.create({
      bundle,
      approver: "reviewer@example.com",
    })
    const tampered = QualityPromotionApproval.ApprovalArtifact.parse({
      ...approval,
      approvalPolicySuggestion: {
        ...approval.approvalPolicySuggestion!,
        suggestedReentryPolicy: {
          ...approval.approvalPolicySuggestion!.suggestedReentryPolicy,
          approvalConcentrationPreset: "org-heavy",
        },
      },
    })

    const reasons = QualityPromotionApproval.verify(bundle, tampered)
    expect(reasons.some((reason) => reason.includes("approval policy suggestion mismatch"))).toBe(true)
  })
})
