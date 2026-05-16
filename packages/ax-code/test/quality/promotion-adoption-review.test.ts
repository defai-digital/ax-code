import { describe, expect, test } from "bun:test"
import { QualityCalibrationModel } from "../../src/quality/calibration-model"
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
      source: "adoption-review-model-v1",
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
      source: "adoption-review-model-v1",
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
      candidateSource: "adoption-review-model-v1",
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
      source: "adoption-review-model-v1",
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
      source: "adoption-review-model-v1",
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
        policyProjectID: "adoption-review-project-1",
        compatibilityApprovalSource: null,
        resolvedAt: "2026-04-20T12:00:00.000Z",
        persistedScope: "project",
        persistedUpdatedAt: "2026-04-20T11:00:00.000Z",
        digest: QualityPromotionReleasePolicy.digest(releasePolicy),
      }),
    },
  })
}

async function clearAdoptionReviews() {
  const keys = await Storage.list(["quality_model_adoption_review"])
  for (const parts of keys) {
    await Storage.remove(parts)
  }
}

describe("QualityPromotionAdoptionReview", () => {
  test("creates, persists, verifies, and lists adoption reviews", async () => {
    const bundle = decisionBundle()
    await clearAdoptionReviews()
    try {
      const review = QualityPromotionAdoptionReview.create({
        bundle,
        reviewer: "staff@example.com",
        role: "staff-engineer",
        rationale: "Reviewed and accepted the policy divergence for this promotion.",
      })
      expect(review.disposition).toBe("accepted_override")
      expect(review.suggestion.adoptionStatus).toBe("diverged")
      expect(QualityPromotionAdoptionReview.verify(bundle, review)).toEqual([])

      await QualityPromotionAdoptionReview.append(review)
      await QualityPromotionAdoptionReview.assertPersisted(review)

      const listed = await QualityPromotionAdoptionReview.list(bundle.source)
      expect(listed).toHaveLength(1)
      expect(listed[0]?.reviewer).toBe("staff@example.com")

      const report = QualityPromotionAdoptionReview.renderReport(review)
      expect(report).toContain("## ax-code quality promotion adoption review")
      expect(report).toContain("- suggestion adoption status: diverged")
    } finally {
      await clearAdoptionReviews()
    }
  })

  test("reports verification failures when the adoption suggestion snapshot is tampered", () => {
    const bundle = decisionBundle()
    const review = QualityPromotionAdoptionReview.create({
      bundle,
      reviewer: "staff@example.com",
      role: "staff-engineer",
      rationale: "Reviewed and accepted the policy divergence for this promotion.",
    })
    const tampered = QualityPromotionAdoptionReview.ReviewArtifact.parse({
      ...review,
      suggestion: {
        ...review.suggestion,
        adoptionStatus: "accepted",
      },
    })

    const reasons = QualityPromotionAdoptionReview.verify(bundle, tampered)
    expect(reasons.some((reason) => reason.includes("status mismatch"))).toBe(true)
  })

  test("requires two distinct qualified override reviews for diverged adoption by default", () => {
    const bundle = decisionBundle()
    const one = QualityPromotionAdoptionReview.create({
      bundle,
      reviewer: "staff1@example.com",
      role: "staff-engineer",
      rationale: "Reviewed divergence.",
    })
    const two = QualityPromotionAdoptionReview.create({
      bundle,
      reviewer: "staff2@example.com",
      role: "director",
      rationale: "Reviewed divergence independently.",
    })

    const failSummary = QualityPromotionAdoptionReview.evaluate(bundle, [one])
    expect(failSummary.overallStatus).toBe("fail")
    expect(failSummary.requirement.minimumReviews).toBe(2)
    expect(failSummary.qualifyingReviews).toBe(1)

    const passSummary = QualityPromotionAdoptionReview.evaluate(bundle, [one, two])
    expect(passSummary.overallStatus).toBe("pass")
    expect(passSummary.distinctQualifiedReviewers).toBe(2)
  })

  test("fails consensus when a qualified rejection review is present", () => {
    const bundle = decisionBundle()
    const one = QualityPromotionAdoptionReview.create({
      bundle,
      reviewer: "staff1@example.com",
      role: "staff-engineer",
      rationale: "Reviewed divergence.",
    })
    const two = QualityPromotionAdoptionReview.create({
      bundle,
      reviewer: "staff2@example.com",
      role: "director",
      rationale: "Reviewed divergence independently.",
    })
    const rejected = QualityPromotionAdoptionReview.create({
      bundle,
      reviewer: "staff3@example.com",
      role: "staff-engineer",
      disposition: "rejected",
      rationale: "Do not accept this override without revisiting the policy choice.",
    })

    const summary = QualityPromotionAdoptionReview.evaluate(bundle, [one, two, rejected])
    expect(summary.overallStatus).toBe("fail")
    expect(summary.qualifyingReviews).toBe(2)
    expect(summary.qualifiedRejectingReviews).toBe(1)
    expect(summary.gates.find((gate) => gate.name === "qualified-rejection-veto")?.status).toBe("fail")
  })

  test("ignores rejection reviews below the required role threshold", () => {
    const bundle = decisionBundle()
    const one = QualityPromotionAdoptionReview.create({
      bundle,
      reviewer: "staff1@example.com",
      role: "staff-engineer",
      rationale: "Reviewed divergence.",
    })
    const two = QualityPromotionAdoptionReview.create({
      bundle,
      reviewer: "staff2@example.com",
      role: "director",
      rationale: "Reviewed divergence independently.",
    })
    const rejected = QualityPromotionAdoptionReview.create({
      bundle,
      reviewer: "engineer1@example.com",
      role: "engineer",
      disposition: "rejected",
      rationale: "I disagree, but not at the required review level.",
    })

    const summary = QualityPromotionAdoptionReview.evaluate(bundle, [one, two, rejected])
    expect(summary.overallStatus).toBe("pass")
    expect(summary.qualifiedRejectingReviews).toBe(0)
    expect(summary.gates.find((gate) => gate.name === "qualified-rejection-veto")?.status).toBe("pass")
  })

  test("resolves persisted reviews for the same decision bundle even when only a subset is provided", async () => {
    const bundle = decisionBundle()
    const laterBundle = QualityPromotionDecisionBundle.DecisionBundle.parse({
      ...bundle,
      createdAt: "2026-04-21T12:00:00.000Z",
    })
    await clearAdoptionReviews()
    try {
      const first = QualityPromotionAdoptionReview.create({
        bundle,
        reviewer: "staff1@example.com",
        role: "staff-engineer",
        rationale: "Reviewed divergence.",
      })
      const second = QualityPromotionAdoptionReview.create({
        bundle,
        reviewer: "staff2@example.com",
        role: "staff-engineer",
        rationale: "Reviewed divergence independently.",
      })
      const otherBundleReview = QualityPromotionAdoptionReview.create({
        bundle: laterBundle,
        reviewer: "staff3@example.com",
        role: "staff-engineer",
        rationale: "Reviewed a newer bundle.",
      })

      await QualityPromotionAdoptionReview.append(first)
      await QualityPromotionAdoptionReview.append(second)
      await QualityPromotionAdoptionReview.append(otherBundleReview)

      const resolved = await QualityPromotionAdoptionReview.resolveForBundle(bundle, [first])
      expect(resolved.map((review) => review.reviewID)).toEqual([first.reviewID, second.reviewID])
    } finally {
      await clearAdoptionReviews()
    }
  })
})
