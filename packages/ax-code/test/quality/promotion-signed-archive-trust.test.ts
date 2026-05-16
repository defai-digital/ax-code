import { describe, expect, test } from "bun:test"
import { QualityPromotionSignedArchive } from "../../src/quality/promotion-signed-archive"
import { QualityPromotionSignedArchiveTrust } from "../../src/quality/promotion-signed-archive-trust"
import { QualityPromotionPackagedArchive } from "../../src/quality/promotion-packaged-archive"
import { QualityPromotionPortableExport } from "../../src/quality/promotion-portable-export"
import { QualityPromotionHandoffPackage } from "../../src/quality/promotion-handoff-package"
import { QualityPromotionArchiveManifest } from "../../src/quality/promotion-archive-manifest"
import { QualityPromotionExportBundle } from "../../src/quality/promotion-export-bundle"
import { QualityPromotionAuditManifest } from "../../src/quality/promotion-audit-manifest"
import { QualityPromotionReleasePacket } from "../../src/quality/promotion-release-packet"
import { QualityPromotionReleaseDecisionRecord } from "../../src/quality/promotion-release-decision-record"
import { QualityPromotionBoardDecision } from "../../src/quality/promotion-board-decision"
import { QualityPromotionReviewDossier } from "../../src/quality/promotion-review-dossier"
import { QualityPromotionSubmissionBundle } from "../../src/quality/promotion-submission-bundle"
import { QualityPromotionApprovalPacket } from "../../src/quality/promotion-approval-packet"
import { QualityPromotionApproval } from "../../src/quality/promotion-approval"
import { QualityPromotionAdoptionReview } from "../../src/quality/promotion-adoption-review"
import { QualityPromotionDecisionBundle } from "../../src/quality/promotion-decision-bundle"
import { QualityPromotionReleasePolicy } from "../../src/quality/promotion-release-policy"
import { QualityCalibrationModel } from "../../src/quality/calibration-model"
import { QualityPromotionEligibility } from "../../src/quality/promotion-eligibility"
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
      source: "signed-archive-trust-model-v1",
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
      source: "signed-archive-trust-model-v1",
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
      candidateSource: "signed-archive-trust-model-v1",
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

function buildSignedArchive() {
  const releasePolicy = QualityPromotionReleasePolicy.defaults()
  const bundle = QualityPromotionDecisionBundle.build({
    benchmark: benchmarkBundle(),
    stability: {
      schemaVersion: 1,
      kind: "ax-code-quality-model-stability-summary",
      source: "signed-archive-trust-model-v1",
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
      source: "signed-archive-trust-model-v1",
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
        policySource: "global",
        policyProjectID: null,
        compatibilityApprovalSource: null,
        resolvedAt: "2026-04-20T12:00:00.000Z",
        persistedScope: "global",
        persistedUpdatedAt: "2026-04-20T11:00:00.000Z",
        digest: QualityPromotionReleasePolicy.digest(releasePolicy),
      }),
    },
  })

  const approval = QualityPromotionApproval.create({
    bundle,
    approver: "reviewer@example.com",
    role: "staff-engineer",
  })
  const adoptionReview = QualityPromotionAdoptionReview.create({
    bundle,
    reviewer: "policy-reviewer@example.com",
    role: "director",
    rationale: "accepted",
  })
  const approvalPacket = QualityPromotionApprovalPacket.create({
    bundle,
    approvals: [approval],
    adoptionReviews: [adoptionReview],
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
    decider: "board@example.com",
    role: "director",
  })
  const releaseDecisionRecord = QualityPromotionReleaseDecisionRecord.create({
    boardDecision,
  })
  const releasePacket = QualityPromotionReleasePacket.create({
    releaseDecisionRecord,
  })
  const auditManifest = QualityPromotionAuditManifest.create({
    releasePacket,
    promotion: QualityPromotionAuditManifest.PromotionSnapshot.parse({
      promotionID: "promo_signed_archive_trust_1",
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
        dossierID: reviewDossier.dossierID,
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
  const exportBundle = QualityPromotionExportBundle.create({ auditManifest })
  const archiveManifest = QualityPromotionArchiveManifest.create({ exportBundle })
  const handoffPackage = QualityPromotionHandoffPackage.create({ archiveManifest })
  const portableExport = QualityPromotionPortableExport.create({ handoffPackage })
  const packagedArchive = QualityPromotionPackagedArchive.create({ portableExport })
  return QualityPromotionSignedArchive.create({
    packagedArchive,
    signing: {
      attestedBy: "release-integrity-bot",
      keyID: "archive-key-v1",
      keySource: "env",
      keyLocator: "AX_CODE_QUALITY_ARCHIVE_KEY",
      keyMaterial: "quality-archive-secret-v1",
    },
  })
}

async function clearTrustRecords() {
  for (const prefix of ["quality_model_signed_archive_trust"]) {
    const keys = await Storage.list([prefix])
    for (const parts of keys) {
      await Storage.remove(parts)
    }
  }
}

describe("QualityPromotionSignedArchiveTrust", () => {
  test("registers trust entries and evaluates active trust as pass", async () => {
    const archive = buildSignedArchive()
    await clearTrustRecords()
    try {
      const trust = QualityPromotionSignedArchiveTrust.create({
        scope: "project",
        projectID: "project-trust-1",
        signing: {
          attestedBy: "release-integrity-bot",
          keyID: "archive-key-v1",
          keySource: "env",
          keyLocator: "AX_CODE_QUALITY_ARCHIVE_KEY",
          keyMaterial: "quality-archive-secret-v1",
        },
        effectiveFrom: "2020-01-01T00:00:00.000Z",
      })
      await QualityPromotionSignedArchiveTrust.append(trust)
      const listed = await QualityPromotionSignedArchiveTrust.list({ scope: "project", projectID: "project-trust-1" })
      expect(listed).toHaveLength(1)
      const summary = await QualityPromotionSignedArchiveTrust.evaluate({
        archive,
        keyMaterial: "quality-archive-secret-v1",
        projectID: "project-trust-1",
      })
      expect(summary.overallStatus).toBe("pass")
      expect(summary.trusted).toBe(true)
      expect(summary.resolution.trustID).toBe(trust.trustID)
    } finally {
      await clearTrustRecords()
    }
  })

  test("treats revoked keys as warn for historical archives signed before revocation", async () => {
    const archive = buildSignedArchive()
    const trust = QualityPromotionSignedArchiveTrust.create({
      scope: "global",
      signing: {
        attestedBy: "release-integrity-bot",
        keyID: "archive-key-v1",
        keySource: "env",
        keyLocator: "AX_CODE_QUALITY_ARCHIVE_KEY",
        keyMaterial: "quality-archive-secret-v1",
      },
      lifecycle: "revoked",
      effectiveFrom: "2026-04-20T00:00:00.000Z",
      revokedAt: "2099-01-01T00:00:00.000Z",
    })
    const summary = await QualityPromotionSignedArchiveTrust.evaluate({
      archive,
      keyMaterial: "quality-archive-secret-v1",
      trusts: [trust],
    })
    expect(summary.overallStatus).toBe("warn")
    expect(summary.lifecycleStatus).toBe("warn")
  })

  test("fails when the provided key does not match the registered trust fingerprint", async () => {
    const archive = buildSignedArchive()
    const trust = QualityPromotionSignedArchiveTrust.create({
      scope: "global",
      signing: {
        attestedBy: "release-integrity-bot",
        keyID: "archive-key-v1",
        keySource: "env",
        keyLocator: "AX_CODE_QUALITY_ARCHIVE_KEY",
        keyMaterial: "quality-archive-secret-v1",
      },
    })
    const summary = await QualityPromotionSignedArchiveTrust.evaluate({
      archive,
      keyMaterial: "wrong-secret",
      trusts: [trust],
    })
    expect(summary.overallStatus).toBe("fail")
    expect(summary.signatureStatus).toBe("fail")
    expect(summary.registryStatus).toBe("fail")
  })
})
