import { describe, expect, test } from "bun:test"
import { QualityCalibrationModel } from "../../src/quality/calibration-model"
import { QualityPromotionAdoptionDissentHandling } from "../../src/quality/promotion-adoption-dissent-handling"
import { QualityPromotionAdoptionDissentResolution } from "../../src/quality/promotion-adoption-dissent-resolution"
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
      source: "adoption-dissent-handling-model-v1",
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
      source: "adoption-dissent-handling-model-v1",
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
      candidateSource: "adoption-dissent-handling-model-v1",
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
      source: "adoption-dissent-handling-model-v1",
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
      source: "adoption-dissent-handling-model-v1",
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
        policyProjectID: "adoption-dissent-handling-project-1",
        compatibilityApprovalSource: null,
        resolvedAt: "2026-04-20T12:00:00.000Z",
        persistedScope: "project",
        persistedUpdatedAt: "2026-04-20T11:00:00.000Z",
        digest: QualityPromotionReleasePolicy.digest(releasePolicy),
      }),
    },
  })
}

async function clearHandlings() {
  const keys = await Storage.list(["quality_model_adoption_dissent_handling"])
  for (const parts of keys) {
    await Storage.remove(parts)
  }
}

describe("QualityPromotionAdoptionDissentHandling", () => {
  test("creates, persists, verifies, and lists handling bundles", async () => {
    const bundle = decisionBundle()
    await clearHandlings()
    try {
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
      const resolution = QualityPromotionAdoptionDissentResolution.create({
        bundle,
        targetReviews: [rejected],
        resolver: "director-resolver@example.com",
        role: "director",
        rationale: "Documented why this dissent is being overridden for the current release.",
      })
      const handling = QualityPromotionAdoptionDissentHandling.create({
        bundle,
        reviews: [acceptedOne, acceptedTwo, rejected],
        resolutions: [resolution],
      })

      expect(
        QualityPromotionAdoptionDissentHandling.verify(bundle, [acceptedOne, acceptedTwo, rejected], handling),
      ).toEqual([])

      await QualityPromotionAdoptionDissentHandling.append(handling)
      await QualityPromotionAdoptionDissentHandling.assertPersisted(handling)

      const listed = await QualityPromotionAdoptionDissentHandling.list(bundle.source)
      expect(listed).toHaveLength(1)
      expect(listed[0]?.summary.overallStatus).toBe("pass")
      expect(listed[0]?.summary.coveredQualifiedRejectingReviews).toBe(1)
    } finally {
      await clearHandlings()
    }
  })

  test("rejects a handling bundle when the qualified rejecting review snapshot changes", () => {
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
    const resolution = QualityPromotionAdoptionDissentResolution.create({
      bundle,
      targetReviews: [rejected],
      resolver: "director-resolver@example.com",
      role: "director",
      rationale: "Documented why this dissent is being overridden for the current release.",
    })
    const handling = QualityPromotionAdoptionDissentHandling.create({
      bundle,
      reviews: [acceptedOne, acceptedTwo, rejected],
      resolutions: [resolution],
    })
    const newRejected = QualityPromotionAdoptionReview.create({
      bundle,
      reviewer: "principal-dissent@example.com",
      role: "principal-engineer",
      disposition: "rejected",
      rationale: "A new dissent should invalidate the old bundle snapshot.",
    })

    expect(
      QualityPromotionAdoptionDissentHandling.verify(
        bundle,
        [acceptedOne, acceptedTwo, rejected, newRejected],
        handling,
      ),
    ).toContain("dissent handling qualified rejecting review snapshot mismatch for adoption-dissent-handling-model-v1")
  })
})
