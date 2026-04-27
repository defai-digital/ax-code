import { describe, expect, test } from "bun:test"
import { QualityCalibrationModel } from "../../src/quality/calibration-model"
import { QualityPromotionAdoptionReview } from "../../src/quality/promotion-adoption-review"
import { QualityPromotionBoardDecision } from "../../src/quality/promotion-board-decision"
import { QualityPromotionApprovalPacket } from "../../src/quality/promotion-approval-packet"
import { QualityPromotionApproval } from "../../src/quality/promotion-approval"
import { QualityPromotionDecisionBundle } from "../../src/quality/promotion-decision-bundle"
import { QualityPromotionEligibility } from "../../src/quality/promotion-eligibility"
import { QualityPromotionReleaseDecisionRecord } from "../../src/quality/promotion-release-decision-record"
import { QualityPromotionReleasePolicy } from "../../src/quality/promotion-release-policy"
import { QualityPromotionReviewDossier } from "../../src/quality/promotion-review-dossier"
import { QualityPromotionSubmissionBundle } from "../../src/quality/promotion-submission-bundle"
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
      source: "release-decision-record-model-v1",
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
      source: "release-decision-record-model-v1",
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
      candidateSource: "release-decision-record-model-v1",
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
      source: "release-decision-record-model-v1",
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
      source: "release-decision-record-model-v1",
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
        policyProjectID: "release-decision-record-project-1",
        compatibilityApprovalSource: null,
        resolvedAt: "2026-04-20T12:00:00.000Z",
        persistedScope: "project",
        persistedUpdatedAt: "2026-04-20T11:00:00.000Z",
        digest: QualityPromotionReleasePolicy.digest(releasePolicy),
      }),
    },
  })
}

async function clearRecords() {
  const recordKeys = await Storage.list(["quality_model_release_decision_record"])
  for (const parts of recordKeys) {
    await Storage.remove(parts)
  }
  const boardDecisionKeys = await Storage.list(["quality_model_board_decision"])
  for (const parts of boardDecisionKeys) {
    await Storage.remove(parts)
  }
  const dossierKeys = await Storage.list(["quality_model_review_dossier"])
  for (const parts of dossierKeys) {
    await Storage.remove(parts)
  }
  const submissionKeys = await Storage.list(["quality_model_submission_bundle"])
  for (const parts of submissionKeys) {
    await Storage.remove(parts)
  }
  const packetKeys = await Storage.list(["quality_model_approval_packet"])
  for (const parts of packetKeys) {
    await Storage.remove(parts)
  }
}

describe("QualityPromotionReleaseDecisionRecord", () => {
  test("creates, persists, verifies, and lists release decision records", async () => {
    const bundle = decisionBundle()
    await clearRecords()
    try {
      const approval = QualityPromotionApproval.create({
        bundle,
        approver: "reviewer@example.com",
        role: "staff-engineer",
      })
      const reviewOne = QualityPromotionAdoptionReview.create({
        bundle,
        reviewer: "policy-reviewer-1@example.com",
        role: "staff-engineer",
        rationale: "Reviewed and accepted the current policy adoption state for this promotion.",
      })
      const reviewTwo = QualityPromotionAdoptionReview.create({
        bundle,
        reviewer: "policy-reviewer-2@example.com",
        role: "director",
        rationale: "Reviewed and accepted the current policy adoption state for this promotion.",
      })
      const packet = QualityPromotionApprovalPacket.create({
        bundle,
        approvals: [approval],
        adoptionReviews: [reviewOne, reviewTwo],
      })
      const submission = QualityPromotionSubmissionBundle.create({
        decisionBundle: bundle,
        approvalPacket: packet,
      })
      const dossier = QualityPromotionReviewDossier.create({
        submissionBundle: submission,
      })
      const boardDecision = QualityPromotionBoardDecision.create({
        reviewDossier: dossier,
        decider: "board-chair@example.com",
        role: "director",
        team: "quality-governance",
        reportingChain: "eng/quality/release-board",
        rationale: "Final board sign-off completed.",
      })
      const record = QualityPromotionReleaseDecisionRecord.create({
        boardDecision,
      })

      expect(QualityPromotionReleaseDecisionRecord.verify(bundle, record)).toEqual([])

      await QualityPromotionReleaseDecisionRecord.append(record)
      await QualityPromotionReleaseDecisionRecord.assertPersisted(record)

      const listed = await QualityPromotionReleaseDecisionRecord.list(bundle.source)
      expect(listed).toHaveLength(1)
      expect(listed[0]?.summary.overallStatus).toBe("pass")
      expect(listed[0]?.summary.promotionMode).toBe("pass")
      expect(listed[0]?.boardDecision.decisionID).toBe(boardDecision.decisionID)
    } finally {
      await clearRecords()
    }
  })

  test("reports verification failures when the release decision record summary is tampered", () => {
    const bundle = decisionBundle()
    const approval = QualityPromotionApproval.create({
      bundle,
      approver: "reviewer@example.com",
      role: "staff-engineer",
    })
    const reviewOne = QualityPromotionAdoptionReview.create({
      bundle,
      reviewer: "policy-reviewer-1@example.com",
      role: "staff-engineer",
      rationale: "Reviewed and accepted the current policy adoption state for this promotion.",
    })
    const reviewTwo = QualityPromotionAdoptionReview.create({
      bundle,
      reviewer: "policy-reviewer-2@example.com",
      role: "director",
      rationale: "Reviewed and accepted the current policy adoption state for this promotion.",
    })
    const packet = QualityPromotionApprovalPacket.create({
      bundle,
      approvals: [approval],
      adoptionReviews: [reviewOne, reviewTwo],
    })
    const submission = QualityPromotionSubmissionBundle.create({
      decisionBundle: bundle,
      approvalPacket: packet,
    })
    const dossier = QualityPromotionReviewDossier.create({
      submissionBundle: submission,
    })
    const boardDecision = QualityPromotionBoardDecision.create({
      reviewDossier: dossier,
      decider: "board-chair@example.com",
      role: "director",
    })
    const record = QualityPromotionReleaseDecisionRecord.create({
      boardDecision,
    })
    const tampered = QualityPromotionReleaseDecisionRecord.RecordArtifact.parse({
      ...record,
      summary: {
        ...record.summary,
        promotionMode: "force",
      },
    })

    const reasons = QualityPromotionReleaseDecisionRecord.verify(bundle, tampered)
    expect(reasons.some((reason) => reason.includes("release decision record summary mismatch"))).toBe(true)
  })

  test("does not authorize promotion when the board decision is held even if overrideAccepted is true", () => {
    const bundle = decisionBundle()
    const approval = QualityPromotionApproval.create({
      bundle,
      approver: "reviewer@example.com",
      role: "staff-engineer",
    })
    const reviewOne = QualityPromotionAdoptionReview.create({
      bundle,
      reviewer: "policy-reviewer-1@example.com",
      role: "staff-engineer",
      rationale: "Reviewed and accepted the current policy adoption state for this promotion.",
    })
    const reviewTwo = QualityPromotionAdoptionReview.create({
      bundle,
      reviewer: "policy-reviewer-2@example.com",
      role: "director",
      rationale: "Reviewed and accepted the current policy adoption state for this promotion.",
    })
    const approvalPacket = QualityPromotionApprovalPacket.create({
      bundle,
      approvals: [approval],
      adoptionReviews: [reviewOne, reviewTwo],
    })
    const submissionBundle = QualityPromotionSubmissionBundle.create({
      decisionBundle: bundle,
      approvalPacket,
    })
    const reviewDossier = QualityPromotionReviewDossier.create({
      submissionBundle,
    })
    const heldBoardDecision = QualityPromotionBoardDecision.create({
      reviewDossier,
      decider: "board-chair@example.com",
      role: "director",
      disposition: "held",
      overrideAccepted: true,
      rationale: "Promotion is held pending follow-up.",
    })
    const record = QualityPromotionReleaseDecisionRecord.create({
      boardDecision: heldBoardDecision,
    })

    expect(record.summary.authorizedPromotion).toBe(false)
    expect(record.summary.overallStatus).toBe("fail")
  })
})
