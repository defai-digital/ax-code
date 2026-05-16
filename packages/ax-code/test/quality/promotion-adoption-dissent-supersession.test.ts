import { describe, expect, test } from "bun:test"
import { QualityCalibrationModel } from "../../src/quality/calibration-model"
import { QualityPromotionAdoptionDissentSupersession } from "../../src/quality/promotion-adoption-dissent-supersession"
import { QualityPromotionAdoptionReview } from "../../src/quality/promotion-adoption-review"
import { QualityPromotionDecisionBundle } from "../../src/quality/promotion-decision-bundle"
import { QualityPromotionEligibility } from "../../src/quality/promotion-eligibility"
import { QualityPromotionReleasePolicy } from "../../src/quality/promotion-release-policy"
import { QualityStabilityGuard } from "../../src/quality/stability-guard"
import { Storage } from "../../src/storage/storage"

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
      source: "adoption-dissent-supersession-model-v1",
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
      source: "adoption-dissent-supersession-model-v1",
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
      candidateSource: "adoption-dissent-supersession-model-v1",
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

function decisionBundle() {
  const releasePolicy = QualityPromotionReleasePolicy.defaults({
    watch: {
      minRecords: 25,
    },
  })
  return QualityPromotionDecisionBundle.build({
    benchmark: benchmarkBundle(),
    stability: {
      schemaVersion: 1,
      kind: "ax-code-quality-model-stability-summary",
      source: "adoption-dissent-supersession-model-v1",
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
      gates: [{ name: "cooling-window", status: "pass", detail: "ok" }],
    } satisfies QualityStabilityGuard.StabilitySummary,
    eligibility: {
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-eligibility",
      source: "adoption-dissent-supersession-model-v1",
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
    releasePolicySnapshot: {
      policy: releasePolicy,
      provenance: QualityPromotionReleasePolicy.PolicyProvenance.parse({
        policySource: "project",
        policyProjectID: "adoption-dissent-supersession-project-1",
        compatibilityApprovalSource: null,
        resolvedAt: "2026-04-20T12:00:00.000Z",
        persistedScope: "project",
        persistedUpdatedAt: "2026-04-20T11:00:00.000Z",
        digest: QualityPromotionReleasePolicy.digest(releasePolicy),
      }),
    },
  })
}

async function clearSupersessions() {
  const keys = await Storage.list(["quality_model_adoption_dissent_supersession"])
  for (const parts of keys) {
    await Storage.remove(parts)
  }
}

describe("QualityPromotionAdoptionDissentSupersession", () => {
  test("creates, persists, verifies, and lists supersessions", async () => {
    const bundle = decisionBundle()
    await clearSupersessions()
    try {
      const rejected = QualityPromotionAdoptionReview.create({
        bundle,
        reviewer: "staff-rejector@example.com",
        role: "staff-engineer",
        disposition: "rejected",
        rationale: "Do not accept the current policy divergence.",
      })
      const supersession = QualityPromotionAdoptionDissentSupersession.create({
        bundle,
        targetReviews: [rejected],
        superseder: "staff-rejector@example.com",
        role: "staff-engineer",
        disposition: "withdrawn",
        rationale: "I am withdrawing the earlier dissent after re-review.",
      })
      expect(QualityPromotionAdoptionDissentSupersession.verify(bundle, supersession)).toEqual([])

      await QualityPromotionAdoptionDissentSupersession.append(supersession)
      await QualityPromotionAdoptionDissentSupersession.assertPersisted(supersession)

      const listed = await QualityPromotionAdoptionDissentSupersession.list(bundle.source)
      expect(listed).toHaveLength(1)
      expect(listed[0]?.superseder).toBe("staff-rejector@example.com")
    } finally {
      await clearSupersessions()
    }
  })

  test("passes when the original dissent reviewer withdraws their qualified rejection", () => {
    const bundle = decisionBundle()
    const acceptedOne = QualityPromotionAdoptionReview.create({
      bundle,
      reviewer: "staff1@example.com",
      role: "staff-engineer",
      rationale: "Reviewed divergence.",
    })
    const acceptedTwo = QualityPromotionAdoptionReview.create({
      bundle,
      reviewer: "staff2@example.com",
      role: "director",
      rationale: "Reviewed divergence independently.",
    })
    const rejected = QualityPromotionAdoptionReview.create({
      bundle,
      reviewer: "staff-rejector@example.com",
      role: "staff-engineer",
      disposition: "rejected",
      rationale: "Do not accept the current policy divergence.",
    })
    const supersession = QualityPromotionAdoptionDissentSupersession.create({
      bundle,
      targetReviews: [rejected],
      superseder: "staff-rejector@example.com",
      role: "staff-engineer",
      disposition: "withdrawn",
      rationale: "I am withdrawing the earlier dissent after re-review.",
    })

    const summary = QualityPromotionAdoptionDissentSupersession.evaluate(
      bundle,
      [acceptedOne, acceptedTwo, rejected],
      [supersession],
    )
    expect(summary.overallStatus).toBe("pass")
    expect(summary.coveredQualifiedRejectingReviews).toBe(1)
    expect(summary.coveredByReviewerRereview).toBe(1)
  })

  test("passes when new independent evidence supersedes multiple qualified dissent reviews", () => {
    const bundle = decisionBundle()
    const acceptedOne = QualityPromotionAdoptionReview.create({
      bundle,
      reviewer: "staff1@example.com",
      role: "staff-engineer",
      rationale: "Reviewed divergence.",
    })
    const acceptedTwo = QualityPromotionAdoptionReview.create({
      bundle,
      reviewer: "staff2@example.com",
      role: "director",
      rationale: "Reviewed divergence independently.",
    })
    const rejectedOne = QualityPromotionAdoptionReview.create({
      bundle,
      reviewer: "staff-rejector-1@example.com",
      role: "staff-engineer",
      disposition: "rejected",
      rationale: "Do not accept the current policy divergence.",
    })
    const rejectedTwo = QualityPromotionAdoptionReview.create({
      bundle,
      reviewer: "staff-rejector-2@example.com",
      role: "director",
      disposition: "rejected",
      rationale: "Do not accept the current policy divergence.",
    })
    const supersession = QualityPromotionAdoptionDissentSupersession.create({
      bundle,
      targetReviews: [rejectedOne, rejectedTwo],
      superseder: "principal-evidence@example.com",
      role: "principal-engineer",
      disposition: "superseded_by_new_evidence",
      rationale: "New evidence invalidates both earlier dissent assumptions.",
    })

    const summary = QualityPromotionAdoptionDissentSupersession.evaluate(
      bundle,
      [acceptedOne, acceptedTwo, rejectedOne, rejectedTwo],
      [supersession],
    )
    expect(summary.overallStatus).toBe("pass")
    expect(summary.coveredQualifiedRejectingReviews).toBe(2)
    expect(summary.coveredByEvidenceSupersession).toBe(2)
  })
})
