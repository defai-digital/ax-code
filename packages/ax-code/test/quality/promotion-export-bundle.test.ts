import { describe, expect, test } from "bun:test"
import { QualityCalibrationModel } from "../../src/quality/calibration-model"
import { QualityPromotionAdoptionReview } from "../../src/quality/promotion-adoption-review"
import { QualityPromotionAuditManifest } from "../../src/quality/promotion-audit-manifest"
import { QualityPromotionBoardDecision } from "../../src/quality/promotion-board-decision"
import { QualityPromotionApprovalPacket } from "../../src/quality/promotion-approval-packet"
import { QualityPromotionApproval } from "../../src/quality/promotion-approval"
import { QualityPromotionDecisionBundle } from "../../src/quality/promotion-decision-bundle"
import { QualityPromotionEligibility } from "../../src/quality/promotion-eligibility"
import { QualityPromotionExportBundle } from "../../src/quality/promotion-export-bundle"
import { QualityPromotionReleaseDecisionRecord } from "../../src/quality/promotion-release-decision-record"
import { QualityPromotionReleasePacket } from "../../src/quality/promotion-release-packet"
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
      source: "export-bundle-model-v1",
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
      source: "export-bundle-model-v1",
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
      candidateSource: "export-bundle-model-v1",
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
      source: "export-bundle-model-v1",
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
      source: "export-bundle-model-v1",
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
        policyProjectID: "export-bundle-project-1",
        compatibilityApprovalSource: null,
        resolvedAt: "2026-04-20T12:00:00.000Z",
        persistedScope: "project",
        persistedUpdatedAt: "2026-04-20T11:00:00.000Z",
        digest: QualityPromotionReleasePolicy.digest(releasePolicy),
      }),
    },
  })
}

async function clearExportBundles() {
  for (const prefix of [
    "quality_model_export_bundle",
    "quality_model_audit_manifest",
    "quality_model_release_packet",
    "quality_model_release_decision_record",
    "quality_model_board_decision",
    "quality_model_review_dossier",
    "quality_model_submission_bundle",
    "quality_model_approval_packet",
  ]) {
    const keys = await Storage.list([prefix])
    for (const parts of keys) {
      await Storage.remove(parts)
    }
  }
}

function buildAuditManifest() {
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
  const boardDecision = QualityPromotionBoardDecision.create({
    reviewDossier,
    decider: "board-chair@example.com",
    role: "director",
  })
  const releaseDecisionRecord = QualityPromotionReleaseDecisionRecord.create({
    boardDecision,
  })
  const releasePacket = QualityPromotionReleasePacket.create({
    releaseDecisionRecord,
  })
  const manifest = QualityPromotionAuditManifest.create({
    releasePacket,
    promotion: QualityPromotionAuditManifest.PromotionSnapshot.parse({
      promotionID: "promo_export_bundle_1",
      source: bundle.source,
      promotedAt: "2026-04-20T12:30:00.000Z",
      previousActiveSource: "baseline-model-v1",
      decision: "pass",
      decisionBundleCreatedAt: bundle.createdAt,
      boardDecision: {
        decisionID: boardDecision.decisionID,
        decidedAt: boardDecision.decidedAt,
        decider: boardDecision.decider,
        role: boardDecision.role,
        team: boardDecision.team,
        reportingChain: boardDecision.reportingChain,
        disposition: boardDecision.disposition,
        overrideAccepted: boardDecision.overrideAccepted,
        dossierID: boardDecision.reviewDossier.dossierID,
        recommendation: boardDecision.summary.recommendation,
        requiredOverride: boardDecision.summary.requiredOverride,
        overallStatus: boardDecision.summary.overallStatus,
      },
      releaseDecisionRecord: {
        recordID: releaseDecisionRecord.recordID,
        recordedAt: releaseDecisionRecord.recordedAt,
        decisionID: boardDecision.decisionID,
        disposition: releaseDecisionRecord.summary.disposition,
        overrideAccepted: releaseDecisionRecord.summary.overrideAccepted,
        authorizedPromotion: releaseDecisionRecord.summary.authorizedPromotion,
        promotionMode: releaseDecisionRecord.summary.promotionMode,
        overallStatus: releaseDecisionRecord.summary.overallStatus,
      },
      releasePacket: {
        packetID: releasePacket.packetID,
        createdAt: releasePacket.createdAt,
        recordID: releaseDecisionRecord.recordID,
        decisionID: boardDecision.decisionID,
        authorizedPromotion: releasePacket.summary.authorizedPromotion,
        promotionMode: releasePacket.summary.promotionMode,
        overallStatus: releasePacket.summary.overallStatus,
      },
      reviewDossier: {
        dossierID: reviewDossier.dossierID,
        createdAt: reviewDossier.createdAt,
        submissionID: submissionBundle.submissionID,
        submissionCreatedAt: submissionBundle.createdAt,
        decisionBundleCreatedAt: bundle.createdAt,
        approvalPacketID: approvalPacket.packetID,
        overallStatus: reviewDossier.summary.overallStatus,
        recommendation: reviewDossier.summary.recommendation,
      },
      submissionBundle: {
        submissionID: submissionBundle.submissionID,
        createdAt: submissionBundle.createdAt,
        decisionBundleCreatedAt: bundle.createdAt,
        approvalPacketID: approvalPacket.packetID,
        overallStatus: submissionBundle.summary.overallStatus,
        eligibilityDecision: submissionBundle.summary.eligibilityDecision,
        requiredOverride: submissionBundle.summary.requiredOverride,
      },
      approvalPacket: {
        packetID: approvalPacket.packetID,
        createdAt: approvalPacket.createdAt,
        decisionBundleCreatedAt: bundle.createdAt,
        decisionBundleDigest: approvalPacket.decisionBundle.digest,
        adoptionStatus: approvalPacket.readiness.adoptionStatus,
        approvalCount: approvalPacket.readiness.totalApprovals,
        adoptionReviewCount: approvalPacket.readiness.totalAdoptionReviews,
        hasDissentHandling: !!approvalPacket.dissentHandling,
        overallStatus: approvalPacket.readiness.overallStatus,
      },
    }),
  })

  return { bundle, manifest }
}

describe("QualityPromotionExportBundle", () => {
  test("creates, persists, verifies, and lists export bundles", async () => {
    const { bundle, manifest } = buildAuditManifest()
    await clearExportBundles()
    try {
      const exportBundle = QualityPromotionExportBundle.create({
        auditManifest: manifest,
      })

      expect(QualityPromotionExportBundle.verify(exportBundle)).toEqual([])

      await QualityPromotionExportBundle.append(exportBundle)
      await QualityPromotionExportBundle.assertPersisted(exportBundle)

      const listed = await QualityPromotionExportBundle.list(bundle.source)
      expect(listed).toHaveLength(1)
      expect(listed[0]?.bundleID).toBe(exportBundle.bundleID)
      expect(listed[0]?.auditManifest.promotion.promotionID).toBe("promo_export_bundle_1")
    } finally {
      await clearExportBundles()
    }
  })

  test("reports verification failures when the export bundle summary is tampered", async () => {
    const { manifest } = buildAuditManifest()
    const exportBundle = QualityPromotionExportBundle.create({
      auditManifest: manifest,
    })
    const tampered = QualityPromotionExportBundle.ExportArtifact.parse({
      ...exportBundle,
      summary: {
        ...exportBundle.summary,
        overallStatus: "fail",
      },
    })

    const reasons = QualityPromotionExportBundle.verify(tampered)
    expect(reasons.some((reason) => reason.includes("export bundle summary mismatch"))).toBe(true)
  })
})
