import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"
import { QualityCalibrationModel } from "../../src/quality/calibration-model"
import { QualityPromotionAdoptionReview } from "../../src/quality/promotion-adoption-review"
import { QualityPromotionArchiveManifest } from "../../src/quality/promotion-archive-manifest"
import { QualityPromotionAuditManifest } from "../../src/quality/promotion-audit-manifest"
import { QualityPromotionBoardDecision } from "../../src/quality/promotion-board-decision"
import { QualityPromotionApprovalPacket } from "../../src/quality/promotion-approval-packet"
import { QualityPromotionApproval } from "../../src/quality/promotion-approval"
import { QualityPromotionDecisionBundle } from "../../src/quality/promotion-decision-bundle"
import { QualityPromotionEligibility } from "../../src/quality/promotion-eligibility"
import { QualityPromotionExportBundle } from "../../src/quality/promotion-export-bundle"
import { QualityPromotionHandoffPackage } from "../../src/quality/promotion-handoff-package"
import { QualityModelRegistry } from "../../src/quality/model-registry"
import { QualityPromotionPackagedArchive } from "../../src/quality/promotion-packaged-archive"
import { QualityPromotionPortableExport } from "../../src/quality/promotion-portable-export"
import { QualityPromotionReleaseDecisionRecord } from "../../src/quality/promotion-release-decision-record"
import { QualityPromotionReleasePacket } from "../../src/quality/promotion-release-packet"
import { QualityPromotionReleasePolicy } from "../../src/quality/promotion-release-policy"
import { QualityPromotionReviewDossier } from "../../src/quality/promotion-review-dossier"
import { QualityPromotionSignedArchive } from "../../src/quality/promotion-signed-archive"
import { QualityPromotionSignedArchiveAttestationPacket } from "../../src/quality/promotion-signed-archive-attestation-packet"
import { QualityPromotionSignedArchiveAttestationPolicy } from "../../src/quality/promotion-signed-archive-attestation-policy"
import { QualityPromotionSignedArchiveAttestationRecord } from "../../src/quality/promotion-signed-archive-attestation-record"
import { QualityPromotionSignedArchiveGovernancePacket } from "../../src/quality/promotion-signed-archive-governance-packet"
import { QualityPromotionSignedArchiveReviewDossier } from "../../src/quality/promotion-signed-archive-review-dossier"
import { QualityPromotionSignedArchiveTrust } from "../../src/quality/promotion-signed-archive-trust"
import { QualityPromotionSubmissionBundle } from "../../src/quality/promotion-submission-bundle"
import { QualityStabilityGuard } from "../../src/quality/stability-guard"
import { Storage } from "../../src/storage/storage"
import { tmpdir } from "../fixture/fixture"

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
      source: "signed-archive-model-v1",
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
      source: "signed-archive-model-v1",
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
      candidateSource: "signed-archive-model-v1",
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
      source: "signed-archive-model-v1",
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
      source: "signed-archive-model-v1",
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
        policyProjectID: "signed-archive-project-1",
        compatibilityApprovalSource: null,
        resolvedAt: "2026-04-20T12:00:00.000Z",
        persistedScope: "project",
        persistedUpdatedAt: "2026-04-20T11:00:00.000Z",
        digest: QualityPromotionReleasePolicy.digest(releasePolicy),
      }),
    },
  })
}

async function clearSignedArchives() {
  for (const prefix of [
    "quality_model_signed_archive",
    "quality_model_signed_archive_trust",
    "quality_model_signed_archive_attestation_record",
    "quality_model_signed_archive_attestation_packet",
    "quality_model_signed_archive_governance_packet",
    "quality_model_signed_archive_review_dossier",
    "quality_model_promotion",
    "quality_model_packaged_archive",
    "quality_model_portable_export",
    "quality_model_handoff_package",
    "quality_model_archive_manifest",
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

function buildPackagedArchive() {
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
  const auditManifest = QualityPromotionAuditManifest.create({
    releasePacket,
    promotion: QualityPromotionAuditManifest.PromotionSnapshot.parse({
      promotionID: "promo_signed_archive_1",
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
  const exportBundle = QualityPromotionExportBundle.create({
    auditManifest,
  })
  const archiveManifest = QualityPromotionArchiveManifest.create({
    exportBundle,
  })
  const handoffPackage = QualityPromotionHandoffPackage.create({
    archiveManifest,
  })
  const portableExport = QualityPromotionPortableExport.create({
    handoffPackage,
  })
  const packagedArchive = QualityPromotionPackagedArchive.create({
    portableExport,
  })

  return { bundle, packagedArchive }
}

describe("QualityPromotionSignedArchive", () => {
  test("creates, persists, verifies, signs, lists, and materializes signed archives", async () => {
    const { bundle, packagedArchive } = buildPackagedArchive()
    await clearSignedArchives()
    await using tmp = await tmpdir()
    try {
      const signedArchive = QualityPromotionSignedArchive.create({
        packagedArchive,
        signing: {
          attestedBy: "release-integrity-bot",
          keyID: "archive-key-v1",
          keySource: "env",
          keyLocator: "AX_CODE_QUALITY_ARCHIVE_KEY",
          keyMaterial: "quality-archive-secret-v1",
        },
      })

      expect(QualityPromotionSignedArchive.verify(signedArchive)).toEqual([])
      expect(QualityPromotionSignedArchive.verifySignature(signedArchive, "quality-archive-secret-v1")).toEqual([])

      await QualityPromotionSignedArchive.append(signedArchive)
      await QualityPromotionSignedArchive.assertPersisted(signedArchive)

      const listed = await QualityPromotionSignedArchive.list(bundle.source)
      expect(listed).toHaveLength(1)
      expect(listed[0]?.signedArchiveID).toBe(signedArchive.signedArchiveID)
      expect(listed[0]?.summary.keyID).toBe("archive-key-v1")

      const outFile = path.join(tmp.path, "signed", "promotion.signed-archive.json")
      const result = await QualityPromotionSignedArchive.materialize(signedArchive, outFile)
      expect(result.byteLength).toBeGreaterThan(0)
      const json = await fs.readFile(outFile, "utf8")
      expect(json).toContain("\"kind\": \"ax-code-quality-promotion-signed-archive\"")
      expect(json).toContain("\"keyID\": \"archive-key-v1\"")
    } finally {
      await clearSignedArchives()
    }
  })

  test("reports verification failures when the signed archive payload is tampered", () => {
    const { packagedArchive } = buildPackagedArchive()
    const signedArchive = QualityPromotionSignedArchive.create({
      packagedArchive,
      signing: {
        attestedBy: "release-integrity-bot",
        keyID: "archive-key-v1",
        keySource: "env",
        keyLocator: "AX_CODE_QUALITY_ARCHIVE_KEY",
        keyMaterial: "quality-archive-secret-v1",
      },
    })
    const tampered = QualityPromotionSignedArchive.ArchiveArtifact.parse({
      ...signedArchive,
      attestation: {
        ...signedArchive.attestation,
        payloadDigest: "deadbeef",
      },
    })

    const reasons = QualityPromotionSignedArchive.verify(tampered)
    expect(reasons.some((reason) => reason.includes("payload digest mismatch"))).toBe(true)
    const signatureReasons = QualityPromotionSignedArchive.verifySignature(signedArchive, "wrong-secret")
    expect(signatureReasons.some((reason) => reason.includes("signature mismatch"))).toBe(true)
  })
})

describe("QualityPromotionSignedArchiveAttestationRecord", () => {
  test("creates, persists, verifies, and lists attestation records", async () => {
    const { bundle, packagedArchive } = buildPackagedArchive()
    await clearSignedArchives()
    try {
      const signing = {
        attestedBy: "release-integrity-bot",
        keyID: "archive-key-v1",
        keySource: "env" as const,
        keyLocator: "AX_CODE_QUALITY_ARCHIVE_KEY",
        keyMaterial: "quality-archive-secret-v1",
      }
      const signedArchive = QualityPromotionSignedArchive.create({
        packagedArchive,
        signing,
      })
      const trustEntry = QualityPromotionSignedArchiveTrust.create({
        scope: "project",
        projectID: "signed-archive-project-1",
        signing,
      })
      await QualityPromotionSignedArchiveTrust.append(trustEntry)
      const trust = await QualityPromotionSignedArchiveTrust.evaluate({
        archive: signedArchive,
        keyMaterial: signing.keyMaterial,
        projectID: "signed-archive-project-1",
      })
      const attestation = QualityPromotionSignedArchiveAttestationPolicy.evaluate({
        trust,
        policy: QualityPromotionSignedArchiveAttestationPolicy.defaults({
          minimumTrustScope: "project",
        }),
        policySource: "project",
        policyProjectID: "signed-archive-project-1",
      })
      const record = QualityPromotionSignedArchiveAttestationRecord.create({
        signedArchive,
        trust,
        attestation,
      })

      expect(QualityPromotionSignedArchiveAttestationRecord.verify(record)).toEqual([])

      await QualityPromotionSignedArchiveAttestationRecord.append(record)
      await QualityPromotionSignedArchiveAttestationRecord.assertPersisted(record)

      const listed = await QualityPromotionSignedArchiveAttestationRecord.list(bundle.source)
      expect(listed).toHaveLength(1)
      expect(listed[0]?.recordID).toBe(record.recordID)
      expect(listed[0]?.summary.policySource).toBe("project")
      expect(QualityPromotionSignedArchiveAttestationRecord.renderReport(record)).toContain("signed archive id")
    } finally {
      await clearSignedArchives()
    }
  })

  test("reports verification failures when the embedded trust summary is tampered", async () => {
    const { packagedArchive } = buildPackagedArchive()
    const signing = {
      attestedBy: "release-integrity-bot",
      keyID: "archive-key-v1",
      keySource: "env" as const,
      keyLocator: "AX_CODE_QUALITY_ARCHIVE_KEY",
      keyMaterial: "quality-archive-secret-v1",
    }
    const signedArchive = QualityPromotionSignedArchive.create({
      packagedArchive,
      signing,
    })
    const trust = await QualityPromotionSignedArchiveTrust.evaluate({
      archive: signedArchive,
      keyMaterial: signing.keyMaterial,
      trusts: [
        QualityPromotionSignedArchiveTrust.create({
          scope: "project",
          projectID: "signed-archive-project-1",
          signing,
        }),
      ],
      projectID: "signed-archive-project-1",
    })
    const attestation = QualityPromotionSignedArchiveAttestationPolicy.evaluate({
      trust,
      policy: QualityPromotionSignedArchiveAttestationPolicy.defaults({
        minimumTrustScope: "project",
      }),
      policySource: "project",
      policyProjectID: "signed-archive-project-1",
    })
    const record = QualityPromotionSignedArchiveAttestationRecord.create({
      signedArchive,
      trust,
      attestation,
    })
    const tampered = QualityPromotionSignedArchiveAttestationRecord.RecordArtifact.parse({
      ...record,
      trust: {
        ...record.trust,
        attestedBy: "tampered-attestor@example.com",
      },
    })

    const reasons = QualityPromotionSignedArchiveAttestationRecord.verify(tampered)
    expect(reasons.some((reason) => reason.includes("attestation record summary mismatch"))).toBe(true)
  })

  test("rejects explicit attestation records that do not match the promotion provenance", async () => {
    const { packagedArchive } = buildPackagedArchive()
    await clearSignedArchives()
    await using tmp = await tmpdir()
    try {
      const signing = {
        attestedBy: "release-integrity-bot",
        keyID: "archive-key-v1",
        keySource: "env" as const,
        keyLocator: "AX_CODE_QUALITY_ARCHIVE_KEY",
        keyMaterial: "quality-archive-secret-v1",
      }
      const signedArchive = QualityPromotionSignedArchive.create({
        packagedArchive,
        signing,
      })
      const trustEntry = QualityPromotionSignedArchiveTrust.create({
        scope: "project",
        projectID: "signed-archive-project-1",
        signing,
      })
      await QualityPromotionSignedArchiveTrust.append(trustEntry)
      const trust = await QualityPromotionSignedArchiveTrust.evaluate({
        archive: signedArchive,
        keyMaterial: signing.keyMaterial,
        projectID: "signed-archive-project-1",
      })
      const attestation = QualityPromotionSignedArchiveAttestationPolicy.evaluate({
        trust,
        policy: QualityPromotionSignedArchiveAttestationPolicy.defaults({
          minimumTrustScope: "project",
        }),
        policySource: "project",
        policyProjectID: "signed-archive-project-1",
      })
      const record = QualityPromotionSignedArchiveAttestationRecord.create({
        signedArchive,
        trust,
        attestation,
      })
      const releasePacket = signedArchive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.releasePacket
      const promotion = signedArchive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion
      const wrongRecord = QualityPromotionSignedArchiveAttestationRecord.RecordArtifact.parse({
        ...record,
        recordID: "wrong-attestation-record",
      })
      const promotionRecord = QualityModelRegistry.PromotionRecord.parse({
        schemaVersion: 1,
        kind: "ax-code-quality-model-promotion",
        promotionID: promotion.promotionID,
        source: promotion.source,
        promotedAt: promotion.promotedAt,
        previousActiveSource: promotion.previousActiveSource,
        decision: promotion.decision,
        benchmark: {
          baselineSource: "baseline",
          overallStatus: "pass",
          trainSessions: 2,
          evalSessions: 1,
          labeledTrainingItems: 4,
          gates: [
            {
              name: "dataset-consistency",
              status: "pass",
              detail: "ok",
            },
          ],
        },
        releasePacket: {
          packetID: releasePacket.packetID,
          createdAt: releasePacket.createdAt,
          recordID: releasePacket.releaseDecisionRecord.recordID,
          decisionID: releasePacket.releaseDecisionRecord.boardDecision.decisionID,
          authorizedPromotion: releasePacket.summary.authorizedPromotion,
          promotionMode: releasePacket.summary.promotionMode,
          overallStatus: releasePacket.summary.overallStatus,
        },
        signedArchiveAttestationRecord: {
          recordID: record.recordID,
          createdAt: record.createdAt,
          signedArchiveID: record.signedArchive.signedArchiveID,
          promotionID: record.promotionID,
          trustStatus: record.summary.trustStatus,
          attestationStatus: record.summary.attestationStatus,
          trusted: record.summary.trusted,
          acceptedByPolicy: record.summary.acceptedByPolicy,
          policySource: record.summary.policySource,
          policyProjectID: record.summary.policyProjectID,
          overallStatus: record.summary.overallStatus,
        },
      })
      await Storage.write(["quality_model_promotion", promotionRecord.promotionID], promotionRecord)

      const wrongRecordFile = path.join(tmp.path, "wrong-attestation-record.json")
      await Bun.write(wrongRecordFile, JSON.stringify(wrongRecord, null, 2))

      const result = Bun.spawnSync({
        cmd: [
          "bun",
          "run",
          path.join(import.meta.dir, "../../script/quality-rollout.ts"),
          "--mode",
          "model-signed-archive-attestation-record-status",
          "--promotion-id",
          promotionRecord.promotionID,
          "--signed-archive-attestation-record",
          wrongRecordFile,
        ],
        cwd: path.join(import.meta.dir, "../.."),
        env: process.env,
      })

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr.toString()).toContain(
        `Could not resolve signed archive attestation record ${record.recordID} for promotion ${promotionRecord.promotionID}`,
      )
    } finally {
      await clearSignedArchives()
    }
  })

  test("rejects explicit attestation records that match provenance but fail verification", async () => {
    const { packagedArchive } = buildPackagedArchive()
    await clearSignedArchives()
    await using tmp = await tmpdir()
    try {
      const signing = {
        attestedBy: "release-integrity-bot",
        keyID: "archive-key-v1",
        keySource: "env" as const,
        keyLocator: "AX_CODE_QUALITY_ARCHIVE_KEY",
        keyMaterial: "quality-archive-secret-v1",
      }
      const signedArchive = QualityPromotionSignedArchive.create({
        packagedArchive,
        signing,
      })
      const trustEntry = QualityPromotionSignedArchiveTrust.create({
        scope: "project",
        projectID: "signed-archive-project-1",
        signing,
      })
      await QualityPromotionSignedArchiveTrust.append(trustEntry)
      const trust = await QualityPromotionSignedArchiveTrust.evaluate({
        archive: signedArchive,
        keyMaterial: signing.keyMaterial,
        projectID: "signed-archive-project-1",
      })
      const attestation = QualityPromotionSignedArchiveAttestationPolicy.evaluate({
        trust,
        policy: QualityPromotionSignedArchiveAttestationPolicy.defaults({
          minimumTrustScope: "project",
        }),
        policySource: "project",
        policyProjectID: "signed-archive-project-1",
      })
      const record = QualityPromotionSignedArchiveAttestationRecord.create({
        signedArchive,
        trust,
        attestation,
      })
      const promotion = signedArchive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion
      const tamperedRecord = QualityPromotionSignedArchiveAttestationRecord.RecordArtifact.parse({
        ...record,
        trust: {
          ...record.trust,
          attestedBy: "tampered-attestor@example.com",
        },
      })
      const promotionRecord = QualityModelRegistry.PromotionRecord.parse({
        schemaVersion: 1,
        kind: "ax-code-quality-model-promotion",
        promotionID: promotion.promotionID,
        source: promotion.source,
        promotedAt: promotion.promotedAt,
        previousActiveSource: promotion.previousActiveSource,
        decision: promotion.decision,
        benchmark: {
          baselineSource: "baseline",
          overallStatus: "pass",
          trainSessions: 2,
          evalSessions: 1,
          labeledTrainingItems: 4,
          gates: [
            {
              name: "dataset-consistency",
              status: "pass",
              detail: "ok",
            },
          ],
        },
        signedArchiveAttestationRecord: {
          recordID: record.recordID,
          createdAt: record.createdAt,
          signedArchiveID: record.signedArchive.signedArchiveID,
          promotionID: record.promotionID,
          trustStatus: record.summary.trustStatus,
          attestationStatus: record.summary.attestationStatus,
          trusted: record.summary.trusted,
          acceptedByPolicy: record.summary.acceptedByPolicy,
          policySource: record.summary.policySource,
          policyProjectID: record.summary.policyProjectID,
          overallStatus: record.summary.overallStatus,
        },
      })
      await Storage.write(["quality_model_promotion", promotionRecord.promotionID], promotionRecord)

      const tamperedRecordFile = path.join(tmp.path, "tampered-attestation-record.json")
      await Bun.write(tamperedRecordFile, JSON.stringify(tamperedRecord, null, 2))

      const result = Bun.spawnSync({
        cmd: [
          "bun",
          "run",
          path.join(import.meta.dir, "../../script/quality-rollout.ts"),
          "--mode",
          "model-signed-archive-attestation-record-status",
          "--promotion-id",
          promotionRecord.promotionID,
          "--signed-archive-attestation-record",
          tamperedRecordFile,
        ],
        cwd: path.join(import.meta.dir, "../.."),
        env: process.env,
      })

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr.toString()).toContain(
        `Signed archive attestation record ${record.recordID} for promotion ${promotionRecord.promotionID} is invalid`,
      )
    } finally {
      await clearSignedArchives()
    }
  })
})

describe("QualityPromotionSignedArchiveAttestationPacket", () => {
  test("creates, persists, verifies, and lists attestation packets", async () => {
    const { bundle, packagedArchive } = buildPackagedArchive()
    await clearSignedArchives()
    try {
      const signing = {
        attestedBy: "release-integrity-bot",
        keyID: "archive-key-v1",
        keySource: "env" as const,
        keyLocator: "AX_CODE_QUALITY_ARCHIVE_KEY",
        keyMaterial: "quality-archive-secret-v1",
      }
      const signedArchive = QualityPromotionSignedArchive.create({
        packagedArchive,
        signing,
      })
      const trustEntry = QualityPromotionSignedArchiveTrust.create({
        scope: "project",
        projectID: "signed-archive-project-1",
        signing,
      })
      await QualityPromotionSignedArchiveTrust.append(trustEntry)
      const trust = await QualityPromotionSignedArchiveTrust.evaluate({
        archive: signedArchive,
        keyMaterial: signing.keyMaterial,
        projectID: "signed-archive-project-1",
      })
      const attestation = QualityPromotionSignedArchiveAttestationPolicy.evaluate({
        trust,
        policy: QualityPromotionSignedArchiveAttestationPolicy.defaults({
          minimumTrustScope: "project",
        }),
        policySource: "project",
        policyProjectID: "signed-archive-project-1",
      })
      const record = QualityPromotionSignedArchiveAttestationRecord.create({
        signedArchive,
        trust,
        attestation,
      })
      const releasePacket = signedArchive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.releasePacket
      const promotion = signedArchive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion
      const packet = QualityPromotionSignedArchiveAttestationPacket.create({
        promotion: QualityPromotionSignedArchiveAttestationPacket.PromotionReference.parse({
          promotionID: promotion.promotionID,
          source: promotion.source,
          promotedAt: promotion.promotedAt,
          decision: promotion.decision,
          previousActiveSource: promotion.previousActiveSource,
          releasePacketID: releasePacket.packetID,
          promotionMode: releasePacket.summary.promotionMode,
          authorizedPromotion: releasePacket.summary.authorizedPromotion,
          signedArchiveID: signedArchive.signedArchiveID,
        }),
        attestationRecord: record,
      })

      expect(QualityPromotionSignedArchiveAttestationPacket.verify(packet)).toEqual([])

      await QualityPromotionSignedArchiveAttestationPacket.append(packet)
      await QualityPromotionSignedArchiveAttestationPacket.assertPersisted(packet)

      const listed = await QualityPromotionSignedArchiveAttestationPacket.list(bundle.source)
      expect(listed).toHaveLength(1)
      expect(listed[0]?.packetID).toBe(packet.packetID)
      expect(listed[0]?.summary.policySource).toBe("project")
      expect(QualityPromotionSignedArchiveAttestationPacket.renderReport(packet)).toContain("promotion id")
    } finally {
      await clearSignedArchives()
    }
  })

  test("reports verification failures when the promotion reference is tampered", async () => {
    const { packagedArchive } = buildPackagedArchive()
    const signing = {
      attestedBy: "release-integrity-bot",
      keyID: "archive-key-v1",
      keySource: "env" as const,
      keyLocator: "AX_CODE_QUALITY_ARCHIVE_KEY",
      keyMaterial: "quality-archive-secret-v1",
    }
    const signedArchive = QualityPromotionSignedArchive.create({
      packagedArchive,
      signing,
    })
    const trust = await QualityPromotionSignedArchiveTrust.evaluate({
      archive: signedArchive,
      keyMaterial: signing.keyMaterial,
      trusts: [
        QualityPromotionSignedArchiveTrust.create({
          scope: "project",
          projectID: "signed-archive-project-1",
          signing,
        }),
      ],
      projectID: "signed-archive-project-1",
    })
    const attestation = QualityPromotionSignedArchiveAttestationPolicy.evaluate({
      trust,
      policy: QualityPromotionSignedArchiveAttestationPolicy.defaults({
        minimumTrustScope: "project",
      }),
      policySource: "project",
      policyProjectID: "signed-archive-project-1",
    })
    const record = QualityPromotionSignedArchiveAttestationRecord.create({
      signedArchive,
      trust,
      attestation,
    })
    const releasePacket = signedArchive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.releasePacket
    const promotion = signedArchive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion
    const packet = QualityPromotionSignedArchiveAttestationPacket.create({
      promotion: QualityPromotionSignedArchiveAttestationPacket.PromotionReference.parse({
        promotionID: promotion.promotionID,
        source: promotion.source,
        promotedAt: promotion.promotedAt,
        decision: promotion.decision,
        previousActiveSource: promotion.previousActiveSource,
        releasePacketID: releasePacket.packetID,
        promotionMode: releasePacket.summary.promotionMode,
        authorizedPromotion: releasePacket.summary.authorizedPromotion,
        signedArchiveID: signedArchive.signedArchiveID,
      }),
      attestationRecord: record,
    })
    const tampered = QualityPromotionSignedArchiveAttestationPacket.PacketArtifact.parse({
      ...packet,
      promotion: {
        ...packet.promotion,
        decision: "force",
      },
    })

    const reasons = QualityPromotionSignedArchiveAttestationPacket.verify(tampered)
    expect(reasons.some((reason) => reason.includes("attestation packet summary mismatch"))).toBe(true)
  })

  test("rejects explicit attestation packets that do not match the promotion provenance", async () => {
    const { packagedArchive } = buildPackagedArchive()
    await clearSignedArchives()
    await using tmp = await tmpdir()
    try {
      const signing = {
        attestedBy: "release-integrity-bot",
        keyID: "archive-key-v1",
        keySource: "env" as const,
        keyLocator: "AX_CODE_QUALITY_ARCHIVE_KEY",
        keyMaterial: "quality-archive-secret-v1",
      }
      const signedArchive = QualityPromotionSignedArchive.create({
        packagedArchive,
        signing,
      })
      const trustEntry = QualityPromotionSignedArchiveTrust.create({
        scope: "project",
        projectID: "signed-archive-project-1",
        signing,
      })
      await QualityPromotionSignedArchiveTrust.append(trustEntry)
      const trust = await QualityPromotionSignedArchiveTrust.evaluate({
        archive: signedArchive,
        keyMaterial: signing.keyMaterial,
        projectID: "signed-archive-project-1",
      })
      const attestation = QualityPromotionSignedArchiveAttestationPolicy.evaluate({
        trust,
        policy: QualityPromotionSignedArchiveAttestationPolicy.defaults({
          minimumTrustScope: "project",
        }),
        policySource: "project",
        policyProjectID: "signed-archive-project-1",
      })
      const record = QualityPromotionSignedArchiveAttestationRecord.create({
        signedArchive,
        trust,
        attestation,
      })
      const releasePacket = signedArchive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.releasePacket
      const promotion = signedArchive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion
      const packet = QualityPromotionSignedArchiveAttestationPacket.create({
        promotion: QualityPromotionSignedArchiveAttestationPacket.PromotionReference.parse({
          promotionID: promotion.promotionID,
          source: promotion.source,
          promotedAt: promotion.promotedAt,
          decision: promotion.decision,
          previousActiveSource: promotion.previousActiveSource,
          releasePacketID: releasePacket.packetID,
          promotionMode: releasePacket.summary.promotionMode,
          authorizedPromotion: releasePacket.summary.authorizedPromotion,
          signedArchiveID: signedArchive.signedArchiveID,
        }),
        attestationRecord: record,
      })
      const wrongPacket = QualityPromotionSignedArchiveAttestationPacket.PacketArtifact.parse({
        ...packet,
        packetID: "wrong-attestation-packet",
      })
      const promotionRecord = QualityModelRegistry.PromotionRecord.parse({
        schemaVersion: 1,
        kind: "ax-code-quality-model-promotion",
        promotionID: promotion.promotionID,
        source: promotion.source,
        promotedAt: promotion.promotedAt,
        previousActiveSource: promotion.previousActiveSource,
        decision: promotion.decision,
        benchmark: {
          baselineSource: "baseline",
          overallStatus: "pass",
          trainSessions: 2,
          evalSessions: 1,
          labeledTrainingItems: 4,
          gates: [
            {
              name: "dataset-consistency",
              status: "pass",
              detail: "ok",
            },
          ],
        },
        releasePacket: {
          packetID: releasePacket.packetID,
          createdAt: releasePacket.createdAt,
          recordID: releasePacket.releaseDecisionRecord.recordID,
          decisionID: releasePacket.releaseDecisionRecord.boardDecision.decisionID,
          authorizedPromotion: releasePacket.summary.authorizedPromotion,
          promotionMode: releasePacket.summary.promotionMode,
          overallStatus: releasePacket.summary.overallStatus,
        },
        signedArchiveAttestationPacket: {
          packetID: packet.packetID,
          createdAt: packet.createdAt,
          promotionID: packet.promotion.promotionID,
          signedArchiveID: packet.summary.signedArchiveID,
          trustStatus: packet.summary.trustStatus,
          attestationStatus: packet.summary.attestationStatus,
          acceptedByPolicy: packet.summary.acceptedByPolicy,
          policySource: packet.summary.policySource,
          policyProjectID: packet.summary.policyProjectID,
          overallStatus: packet.summary.overallStatus,
        },
      })
      await Storage.write(["quality_model_promotion", promotionRecord.promotionID], promotionRecord)

      const wrongPacketFile = path.join(tmp.path, "wrong-attestation-packet.json")
      await Bun.write(wrongPacketFile, JSON.stringify(wrongPacket, null, 2))

      const result = Bun.spawnSync({
        cmd: [
          "bun",
          "run",
          path.join(import.meta.dir, "../../script/quality-rollout.ts"),
          "--mode",
          "model-signed-archive-attestation-packet-status",
          "--promotion-id",
          promotionRecord.promotionID,
          "--signed-archive-attestation-packet",
          wrongPacketFile,
        ],
        cwd: path.join(import.meta.dir, "../.."),
        env: process.env,
      })

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr.toString()).toContain(
        `Could not resolve signed archive attestation packet ${packet.packetID} for promotion ${promotionRecord.promotionID}`,
      )
    } finally {
      await clearSignedArchives()
    }
  })

  test("builds packet status from an explicit attestation record when no packet is persisted", async () => {
    const { packagedArchive } = buildPackagedArchive()
    await clearSignedArchives()
    await using tmp = await tmpdir()
    try {
      const signing = {
        attestedBy: "release-integrity-bot",
        keyID: "archive-key-v1",
        keySource: "env" as const,
        keyLocator: "AX_CODE_QUALITY_ARCHIVE_KEY",
        keyMaterial: "quality-archive-secret-v1",
      }
      const signedArchive = QualityPromotionSignedArchive.create({
        packagedArchive,
        signing,
      })
      const trustEntry = QualityPromotionSignedArchiveTrust.create({
        scope: "project",
        projectID: "signed-archive-project-1",
        signing,
      })
      await QualityPromotionSignedArchiveTrust.append(trustEntry)
      const trust = await QualityPromotionSignedArchiveTrust.evaluate({
        archive: signedArchive,
        keyMaterial: signing.keyMaterial,
        projectID: "signed-archive-project-1",
      })
      const attestation = QualityPromotionSignedArchiveAttestationPolicy.evaluate({
        trust,
        policy: QualityPromotionSignedArchiveAttestationPolicy.defaults({
          minimumTrustScope: "project",
        }),
        policySource: "project",
        policyProjectID: "signed-archive-project-1",
      })
      const record = QualityPromotionSignedArchiveAttestationRecord.create({
        signedArchive,
        trust,
        attestation,
      })
      const releasePacket = signedArchive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.releasePacket
      const promotion = signedArchive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion
      const promotionRecord = QualityModelRegistry.PromotionRecord.parse({
        schemaVersion: 1,
        kind: "ax-code-quality-model-promotion",
        promotionID: promotion.promotionID,
        source: promotion.source,
        promotedAt: promotion.promotedAt,
        previousActiveSource: promotion.previousActiveSource,
        decision: promotion.decision,
        benchmark: {
          baselineSource: "baseline",
          overallStatus: "pass",
          trainSessions: 2,
          evalSessions: 1,
          labeledTrainingItems: 4,
          gates: [
            {
              name: "dataset-consistency",
              status: "pass",
              detail: "ok",
            },
          ],
        },
        releasePacket: {
          packetID: releasePacket.packetID,
          createdAt: releasePacket.createdAt,
          recordID: releasePacket.releaseDecisionRecord.recordID,
          decisionID: releasePacket.releaseDecisionRecord.boardDecision.decisionID,
          authorizedPromotion: releasePacket.summary.authorizedPromotion,
          promotionMode: releasePacket.summary.promotionMode,
          overallStatus: releasePacket.summary.overallStatus,
        },
      })
      await Storage.write(["quality_model_promotion", promotionRecord.promotionID], promotionRecord)

      const recordFile = path.join(tmp.path, "attestation-record.json")
      await Bun.write(recordFile, JSON.stringify(record, null, 2))

      const result = Bun.spawnSync({
        cmd: [
          "bun",
          "run",
          path.join(import.meta.dir, "../../script/quality-rollout.ts"),
          "--mode",
          "model-signed-archive-attestation-packet-status",
          "--promotion-id",
          promotionRecord.promotionID,
          "--signed-archive-attestation-record",
          recordFile,
        ],
        cwd: path.join(import.meta.dir, "../.."),
        env: process.env,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toContain(`promotion id: ${promotionRecord.promotionID}`)
      expect(result.stdout.toString()).toContain(`signed archive id: ${record.signedArchive.signedArchiveID}`)
    } finally {
      await clearSignedArchives()
    }
  })

  test("rejects explicit attestation packets that match provenance but fail verification", async () => {
    const { packagedArchive } = buildPackagedArchive()
    await clearSignedArchives()
    await using tmp = await tmpdir()
    try {
      const signing = {
        attestedBy: "release-integrity-bot",
        keyID: "archive-key-v1",
        keySource: "env" as const,
        keyLocator: "AX_CODE_QUALITY_ARCHIVE_KEY",
        keyMaterial: "quality-archive-secret-v1",
      }
      const signedArchive = QualityPromotionSignedArchive.create({
        packagedArchive,
        signing,
      })
      const trustEntry = QualityPromotionSignedArchiveTrust.create({
        scope: "project",
        projectID: "signed-archive-project-1",
        signing,
      })
      await QualityPromotionSignedArchiveTrust.append(trustEntry)
      const trust = await QualityPromotionSignedArchiveTrust.evaluate({
        archive: signedArchive,
        keyMaterial: signing.keyMaterial,
        projectID: "signed-archive-project-1",
      })
      const attestation = QualityPromotionSignedArchiveAttestationPolicy.evaluate({
        trust,
        policy: QualityPromotionSignedArchiveAttestationPolicy.defaults({
          minimumTrustScope: "project",
        }),
        policySource: "project",
        policyProjectID: "signed-archive-project-1",
      })
      const record = QualityPromotionSignedArchiveAttestationRecord.create({
        signedArchive,
        trust,
        attestation,
      })
      const releasePacket = signedArchive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.releasePacket
      const promotion = signedArchive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion
      const packet = QualityPromotionSignedArchiveAttestationPacket.create({
        promotion: QualityPromotionSignedArchiveAttestationPacket.PromotionReference.parse({
          promotionID: promotion.promotionID,
          source: promotion.source,
          promotedAt: promotion.promotedAt,
          decision: promotion.decision,
          previousActiveSource: promotion.previousActiveSource,
          releasePacketID: releasePacket.packetID,
          promotionMode: releasePacket.summary.promotionMode,
          authorizedPromotion: releasePacket.summary.authorizedPromotion,
          signedArchiveID: signedArchive.signedArchiveID,
        }),
        attestationRecord: record,
      })
      const tamperedPacket = QualityPromotionSignedArchiveAttestationPacket.PacketArtifact.parse({
        ...packet,
        promotion: {
          ...packet.promotion,
          decision: "force",
        },
      })
      const promotionRecord = QualityModelRegistry.PromotionRecord.parse({
        schemaVersion: 1,
        kind: "ax-code-quality-model-promotion",
        promotionID: promotion.promotionID,
        source: promotion.source,
        promotedAt: promotion.promotedAt,
        previousActiveSource: promotion.previousActiveSource,
        decision: promotion.decision,
        benchmark: {
          baselineSource: "baseline",
          overallStatus: "pass",
          trainSessions: 2,
          evalSessions: 1,
          labeledTrainingItems: 4,
          gates: [
            {
              name: "dataset-consistency",
              status: "pass",
              detail: "ok",
            },
          ],
        },
        signedArchiveAttestationPacket: {
          packetID: packet.packetID,
          createdAt: packet.createdAt,
          promotionID: packet.promotion.promotionID,
          signedArchiveID: packet.summary.signedArchiveID,
          trustStatus: packet.summary.trustStatus,
          attestationStatus: packet.summary.attestationStatus,
          acceptedByPolicy: packet.summary.acceptedByPolicy,
          policySource: packet.summary.policySource,
          policyProjectID: packet.summary.policyProjectID,
          overallStatus: packet.summary.overallStatus,
        },
      })
      await Storage.write(["quality_model_promotion", promotionRecord.promotionID], promotionRecord)

      const tamperedPacketFile = path.join(tmp.path, "tampered-attestation-packet.json")
      await Bun.write(tamperedPacketFile, JSON.stringify(tamperedPacket, null, 2))

      const result = Bun.spawnSync({
        cmd: [
          "bun",
          "run",
          path.join(import.meta.dir, "../../script/quality-rollout.ts"),
          "--mode",
          "model-signed-archive-attestation-packet-status",
          "--promotion-id",
          promotionRecord.promotionID,
          "--signed-archive-attestation-packet",
          tamperedPacketFile,
        ],
        cwd: path.join(import.meta.dir, "../.."),
        env: process.env,
      })

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr.toString()).toContain(
        `Signed archive attestation packet ${packet.packetID} for promotion ${promotionRecord.promotionID} is invalid`,
      )
    } finally {
      await clearSignedArchives()
    }
  })
})

describe("QualityPromotionSignedArchiveGovernancePacket", () => {
  test("creates, persists, verifies, and lists governance packets", async () => {
    const { bundle, packagedArchive } = buildPackagedArchive()
    await clearSignedArchives()
    try {
      const signing = {
        attestedBy: "release-integrity-bot",
        keyID: "archive-key-v1",
        keySource: "env" as const,
        keyLocator: "AX_CODE_QUALITY_ARCHIVE_KEY",
        keyMaterial: "quality-archive-secret-v1",
      }
      const signedArchive = QualityPromotionSignedArchive.create({
        packagedArchive,
        signing,
      })
      const trustEntry = QualityPromotionSignedArchiveTrust.create({
        scope: "project",
        projectID: "signed-archive-project-1",
        signing,
      })
      await QualityPromotionSignedArchiveTrust.append(trustEntry)
      const trust = await QualityPromotionSignedArchiveTrust.evaluate({
        archive: signedArchive,
        keyMaterial: signing.keyMaterial,
        projectID: "signed-archive-project-1",
      })
      const attestation = QualityPromotionSignedArchiveAttestationPolicy.evaluate({
        trust,
        policy: QualityPromotionSignedArchiveAttestationPolicy.defaults({
          minimumTrustScope: "project",
        }),
        policySource: "project",
        policyProjectID: "signed-archive-project-1",
      })
      const record = QualityPromotionSignedArchiveAttestationRecord.create({
        signedArchive,
        trust,
        attestation,
      })
      const releasePacket = signedArchive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.releasePacket
      const promotion = signedArchive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion
      const attestationPacket = QualityPromotionSignedArchiveAttestationPacket.create({
        promotion: QualityPromotionSignedArchiveAttestationPacket.PromotionReference.parse({
          promotionID: promotion.promotionID,
          source: promotion.source,
          promotedAt: promotion.promotedAt,
          decision: promotion.decision,
          previousActiveSource: promotion.previousActiveSource,
          releasePacketID: releasePacket.packetID,
          promotionMode: releasePacket.summary.promotionMode,
          authorizedPromotion: releasePacket.summary.authorizedPromotion,
          signedArchiveID: signedArchive.signedArchiveID,
        }),
        attestationRecord: record,
      })
      const governancePacket = QualityPromotionSignedArchiveGovernancePacket.create({
        promotion: attestationPacket.promotion,
        releasePacket,
        attestationPacket,
      })

      expect(QualityPromotionSignedArchiveGovernancePacket.verify(governancePacket)).toEqual([])

      await QualityPromotionSignedArchiveGovernancePacket.append(governancePacket)
      await QualityPromotionSignedArchiveGovernancePacket.assertPersisted(governancePacket)

      const listed = await QualityPromotionSignedArchiveGovernancePacket.list(bundle.source)
      expect(listed).toHaveLength(1)
      expect(listed[0]?.packetID).toBe(governancePacket.packetID)
      expect(listed[0]?.summary.policySource).toBe("project")
      expect(QualityPromotionSignedArchiveGovernancePacket.renderReport(governancePacket)).toContain("release packet id")
    } finally {
      await clearSignedArchives()
    }
  })

  test("reports verification failures when the release packet linkage is tampered", async () => {
    const { packagedArchive } = buildPackagedArchive()
    const signing = {
      attestedBy: "release-integrity-bot",
      keyID: "archive-key-v1",
      keySource: "env" as const,
      keyLocator: "AX_CODE_QUALITY_ARCHIVE_KEY",
      keyMaterial: "quality-archive-secret-v1",
    }
    const signedArchive = QualityPromotionSignedArchive.create({
      packagedArchive,
      signing,
    })
    const trust = await QualityPromotionSignedArchiveTrust.evaluate({
      archive: signedArchive,
      keyMaterial: signing.keyMaterial,
      trusts: [
        QualityPromotionSignedArchiveTrust.create({
          scope: "project",
          projectID: "signed-archive-project-1",
          signing,
        }),
      ],
      projectID: "signed-archive-project-1",
    })
    const attestation = QualityPromotionSignedArchiveAttestationPolicy.evaluate({
      trust,
      policy: QualityPromotionSignedArchiveAttestationPolicy.defaults({
        minimumTrustScope: "project",
      }),
      policySource: "project",
      policyProjectID: "signed-archive-project-1",
    })
    const record = QualityPromotionSignedArchiveAttestationRecord.create({
      signedArchive,
      trust,
      attestation,
    })
    const releasePacket = signedArchive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.releasePacket
    const promotion = signedArchive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion
    const attestationPacket = QualityPromotionSignedArchiveAttestationPacket.create({
      promotion: QualityPromotionSignedArchiveAttestationPacket.PromotionReference.parse({
        promotionID: promotion.promotionID,
        source: promotion.source,
        promotedAt: promotion.promotedAt,
        decision: promotion.decision,
        previousActiveSource: promotion.previousActiveSource,
        releasePacketID: releasePacket.packetID,
        promotionMode: releasePacket.summary.promotionMode,
        authorizedPromotion: releasePacket.summary.authorizedPromotion,
        signedArchiveID: signedArchive.signedArchiveID,
      }),
      attestationRecord: record,
    })
    const governancePacket = QualityPromotionSignedArchiveGovernancePacket.create({
      promotion: attestationPacket.promotion,
      releasePacket,
      attestationPacket,
    })
    const tampered = QualityPromotionSignedArchiveGovernancePacket.PacketArtifact.parse({
      ...governancePacket,
      promotion: {
        ...governancePacket.promotion,
        releasePacketID: "wrong-release-packet",
      },
    })

    const reasons = QualityPromotionSignedArchiveGovernancePacket.verify(tampered)
    expect(reasons.some((reason) => reason.includes("summary mismatch"))).toBe(true)
  })

  test("builds governance packet status from explicit release packet and attestation record when no governance packet is persisted", async () => {
    const { packagedArchive } = buildPackagedArchive()
    await clearSignedArchives()
    await using tmp = await tmpdir()
    try {
      const signing = {
        attestedBy: "release-integrity-bot",
        keyID: "archive-key-v1",
        keySource: "env" as const,
        keyLocator: "AX_CODE_QUALITY_ARCHIVE_KEY",
        keyMaterial: "quality-archive-secret-v1",
      }
      const signedArchive = QualityPromotionSignedArchive.create({
        packagedArchive,
        signing,
      })
      const trustEntry = QualityPromotionSignedArchiveTrust.create({
        scope: "project",
        projectID: "signed-archive-project-1",
        signing,
      })
      await QualityPromotionSignedArchiveTrust.append(trustEntry)
      const trust = await QualityPromotionSignedArchiveTrust.evaluate({
        archive: signedArchive,
        keyMaterial: signing.keyMaterial,
        projectID: "signed-archive-project-1",
      })
      const attestation = QualityPromotionSignedArchiveAttestationPolicy.evaluate({
        trust,
        policy: QualityPromotionSignedArchiveAttestationPolicy.defaults({
          minimumTrustScope: "project",
        }),
        policySource: "project",
        policyProjectID: "signed-archive-project-1",
      })
      const record = QualityPromotionSignedArchiveAttestationRecord.create({
        signedArchive,
        trust,
        attestation,
      })
      const releasePacket = signedArchive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.releasePacket
      const promotion = signedArchive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion
      const promotionRecord = QualityModelRegistry.PromotionRecord.parse({
        schemaVersion: 1,
        kind: "ax-code-quality-model-promotion",
        promotionID: promotion.promotionID,
        source: promotion.source,
        promotedAt: promotion.promotedAt,
        previousActiveSource: promotion.previousActiveSource,
        decision: promotion.decision,
        benchmark: {
          baselineSource: "baseline",
          overallStatus: "pass",
          trainSessions: 2,
          evalSessions: 1,
          labeledTrainingItems: 4,
          gates: [
            {
              name: "dataset-consistency",
              status: "pass",
              detail: "ok",
            },
          ],
        },
        releasePacket: {
          packetID: releasePacket.packetID,
          createdAt: releasePacket.createdAt,
          recordID: releasePacket.releaseDecisionRecord.recordID,
          decisionID: releasePacket.releaseDecisionRecord.boardDecision.decisionID,
          authorizedPromotion: releasePacket.summary.authorizedPromotion,
          promotionMode: releasePacket.summary.promotionMode,
          overallStatus: releasePacket.summary.overallStatus,
        },
      })
      await Storage.write(["quality_model_promotion", promotionRecord.promotionID], promotionRecord)

      const releasePacketFile = path.join(tmp.path, "release-packet.json")
      const recordFile = path.join(tmp.path, "attestation-record.json")
      await Bun.write(releasePacketFile, JSON.stringify(releasePacket, null, 2))
      await Bun.write(recordFile, JSON.stringify(record, null, 2))

      const result = Bun.spawnSync({
        cmd: [
          "bun",
          "run",
          path.join(import.meta.dir, "../../script/quality-rollout.ts"),
          "--mode",
          "model-signed-archive-governance-packet-status",
          "--promotion-id",
          promotionRecord.promotionID,
          "--release-packet",
          releasePacketFile,
          "--signed-archive-attestation-record",
          recordFile,
        ],
        cwd: path.join(import.meta.dir, "../.."),
        env: process.env,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toContain(`promotion id: ${promotionRecord.promotionID}`)
      expect(result.stdout.toString()).toContain(`release packet id: ${releasePacket.packetID}`)
    } finally {
      await clearSignedArchives()
    }
  })

  test("rejects explicit governance packets that match provenance but fail verification", async () => {
    const { packagedArchive } = buildPackagedArchive()
    await clearSignedArchives()
    await using tmp = await tmpdir()
    try {
      const signing = {
        attestedBy: "release-integrity-bot",
        keyID: "archive-key-v1",
        keySource: "env" as const,
        keyLocator: "AX_CODE_QUALITY_ARCHIVE_KEY",
        keyMaterial: "quality-archive-secret-v1",
      }
      const signedArchive = QualityPromotionSignedArchive.create({
        packagedArchive,
        signing,
      })
      const trustEntry = QualityPromotionSignedArchiveTrust.create({
        scope: "project",
        projectID: "signed-archive-project-1",
        signing,
      })
      await QualityPromotionSignedArchiveTrust.append(trustEntry)
      const trust = await QualityPromotionSignedArchiveTrust.evaluate({
        archive: signedArchive,
        keyMaterial: signing.keyMaterial,
        projectID: "signed-archive-project-1",
      })
      const attestation = QualityPromotionSignedArchiveAttestationPolicy.evaluate({
        trust,
        policy: QualityPromotionSignedArchiveAttestationPolicy.defaults({
          minimumTrustScope: "project",
        }),
        policySource: "project",
        policyProjectID: "signed-archive-project-1",
      })
      const record = QualityPromotionSignedArchiveAttestationRecord.create({
        signedArchive,
        trust,
        attestation,
      })
      const releasePacket = signedArchive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.releasePacket
      const promotion = signedArchive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion
      const attestationPacket = QualityPromotionSignedArchiveAttestationPacket.create({
        promotion: QualityPromotionSignedArchiveAttestationPacket.PromotionReference.parse({
          promotionID: promotion.promotionID,
          source: promotion.source,
          promotedAt: promotion.promotedAt,
          decision: promotion.decision,
          previousActiveSource: promotion.previousActiveSource,
          releasePacketID: releasePacket.packetID,
          promotionMode: releasePacket.summary.promotionMode,
          authorizedPromotion: releasePacket.summary.authorizedPromotion,
          signedArchiveID: signedArchive.signedArchiveID,
        }),
        attestationRecord: record,
      })
      const governancePacket = QualityPromotionSignedArchiveGovernancePacket.create({
        promotion: attestationPacket.promotion,
        releasePacket,
        attestationPacket,
      })
      const tamperedPacket = QualityPromotionSignedArchiveGovernancePacket.PacketArtifact.parse({
        ...governancePacket,
        promotion: {
          ...governancePacket.promotion,
          releasePacketID: "wrong-release-packet",
        },
      })
      const promotionRecord = QualityModelRegistry.PromotionRecord.parse({
        schemaVersion: 1,
        kind: "ax-code-quality-model-promotion",
        promotionID: promotion.promotionID,
        source: promotion.source,
        promotedAt: promotion.promotedAt,
        previousActiveSource: promotion.previousActiveSource,
        decision: promotion.decision,
        benchmark: {
          baselineSource: "baseline",
          overallStatus: "pass",
          trainSessions: 2,
          evalSessions: 1,
          labeledTrainingItems: 4,
          gates: [
            {
              name: "dataset-consistency",
              status: "pass",
              detail: "ok",
            },
          ],
        },
        signedArchiveGovernancePacket: {
          packetID: governancePacket.packetID,
          createdAt: governancePacket.createdAt,
          promotionID: governancePacket.promotion.promotionID,
          releasePacketID: governancePacket.summary.releasePacketID,
          signedArchiveID: governancePacket.summary.signedArchiveID,
          authorizedPromotion: governancePacket.summary.authorizedPromotion,
          promotionMode: governancePacket.summary.promotionMode,
          policySource: governancePacket.summary.policySource,
          policyProjectID: governancePacket.summary.policyProjectID,
          overallStatus: governancePacket.summary.overallStatus,
        },
      })
      await Storage.write(["quality_model_promotion", promotionRecord.promotionID], promotionRecord)

      const tamperedPacketFile = path.join(tmp.path, "tampered-governance-packet.json")
      await Bun.write(tamperedPacketFile, JSON.stringify(tamperedPacket, null, 2))

      const result = Bun.spawnSync({
        cmd: [
          "bun",
          "run",
          path.join(import.meta.dir, "../../script/quality-rollout.ts"),
          "--mode",
          "model-signed-archive-governance-packet-status",
          "--promotion-id",
          promotionRecord.promotionID,
          "--signed-archive-governance-packet",
          tamperedPacketFile,
        ],
        cwd: path.join(import.meta.dir, "../.."),
        env: process.env,
      })

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr.toString()).toContain(
        `Signed archive governance packet ${governancePacket.packetID} for promotion ${promotionRecord.promotionID} is invalid`,
      )
    } finally {
      await clearSignedArchives()
    }
  })
})

describe("QualityPromotionSignedArchiveReviewDossier", () => {
  test("creates, persists, verifies, and lists signed archive review dossiers", async () => {
    const { bundle, packagedArchive } = buildPackagedArchive()
    await clearSignedArchives()
    try {
      const signing = {
        attestedBy: "release-integrity-bot",
        keyID: "archive-key-v1",
        keySource: "env" as const,
        keyLocator: "AX_CODE_QUALITY_ARCHIVE_KEY",
        keyMaterial: "quality-archive-secret-v1",
      }
      const signedArchive = QualityPromotionSignedArchive.create({
        packagedArchive,
        signing,
      })
      const trustEntry = QualityPromotionSignedArchiveTrust.create({
        scope: "project",
        projectID: "signed-archive-project-1",
        signing,
      })
      await QualityPromotionSignedArchiveTrust.append(trustEntry)
      const trust = await QualityPromotionSignedArchiveTrust.evaluate({
        archive: signedArchive,
        keyMaterial: signing.keyMaterial,
        projectID: "signed-archive-project-1",
      })
      const attestation = QualityPromotionSignedArchiveAttestationPolicy.evaluate({
        trust,
        policy: QualityPromotionSignedArchiveAttestationPolicy.defaults({
          minimumTrustScope: "project",
        }),
        policySource: "project",
        policyProjectID: "signed-archive-project-1",
      })
      const record = QualityPromotionSignedArchiveAttestationRecord.create({
        signedArchive,
        trust,
        attestation,
      })
      const releasePacket = signedArchive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.releasePacket
      const promotion = signedArchive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion
      const governancePacket = QualityPromotionSignedArchiveGovernancePacket.create({
        promotion: QualityPromotionSignedArchiveAttestationPacket.PromotionReference.parse({
          promotionID: promotion.promotionID,
          source: promotion.source,
          promotedAt: promotion.promotedAt,
          decision: promotion.decision,
          previousActiveSource: promotion.previousActiveSource,
          releasePacketID: releasePacket.packetID,
          promotionMode: releasePacket.summary.promotionMode,
          authorizedPromotion: releasePacket.summary.authorizedPromotion,
          signedArchiveID: signedArchive.signedArchiveID,
        }),
        releasePacket,
        attestationPacket: QualityPromotionSignedArchiveAttestationPacket.create({
          promotion: QualityPromotionSignedArchiveAttestationPacket.PromotionReference.parse({
            promotionID: promotion.promotionID,
            source: promotion.source,
            promotedAt: promotion.promotedAt,
            decision: promotion.decision,
            previousActiveSource: promotion.previousActiveSource,
            releasePacketID: releasePacket.packetID,
            promotionMode: releasePacket.summary.promotionMode,
            authorizedPromotion: releasePacket.summary.authorizedPromotion,
            signedArchiveID: signedArchive.signedArchiveID,
          }),
          attestationRecord: record,
        }),
      })
      const dossier = QualityPromotionSignedArchiveReviewDossier.create({
        governancePacket,
        handoffPackage: signedArchive.packagedArchive.portableExport.handoffPackage,
      })

      expect(QualityPromotionSignedArchiveReviewDossier.verify(dossier)).toEqual([])

      await QualityPromotionSignedArchiveReviewDossier.append(dossier)
      await QualityPromotionSignedArchiveReviewDossier.assertPersisted(dossier)

      const listed = await QualityPromotionSignedArchiveReviewDossier.list(bundle.source)
      expect(listed).toHaveLength(1)
      expect(listed[0]?.dossierID).toBe(dossier.dossierID)
      expect(listed[0]?.summary.policySource).toBe("project")
      expect(QualityPromotionSignedArchiveReviewDossier.renderReport(dossier)).toContain("governance packet id")
    } finally {
      await clearSignedArchives()
    }
  })

  test("rejects explicit review dossiers that match provenance but fail verification", async () => {
    const { packagedArchive } = buildPackagedArchive()
    await clearSignedArchives()
    await using tmp = await tmpdir()
    try {
      const signing = {
        attestedBy: "release-integrity-bot",
        keyID: "archive-key-v1",
        keySource: "env" as const,
        keyLocator: "AX_CODE_QUALITY_ARCHIVE_KEY",
        keyMaterial: "quality-archive-secret-v1",
      }
      const signedArchive = QualityPromotionSignedArchive.create({
        packagedArchive,
        signing,
      })
      const trustEntry = QualityPromotionSignedArchiveTrust.create({
        scope: "project",
        projectID: "signed-archive-project-1",
        signing,
      })
      await QualityPromotionSignedArchiveTrust.append(trustEntry)
      const trust = await QualityPromotionSignedArchiveTrust.evaluate({
        archive: signedArchive,
        keyMaterial: signing.keyMaterial,
        projectID: "signed-archive-project-1",
      })
      const attestation = QualityPromotionSignedArchiveAttestationPolicy.evaluate({
        trust,
        policy: QualityPromotionSignedArchiveAttestationPolicy.defaults({
          minimumTrustScope: "project",
        }),
        policySource: "project",
        policyProjectID: "signed-archive-project-1",
      })
      const record = QualityPromotionSignedArchiveAttestationRecord.create({
        signedArchive,
        trust,
        attestation,
      })
      const releasePacket = signedArchive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.releasePacket
      const promotion = signedArchive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion
      const governancePacket = QualityPromotionSignedArchiveGovernancePacket.create({
        promotion: QualityPromotionSignedArchiveAttestationPacket.PromotionReference.parse({
          promotionID: promotion.promotionID,
          source: promotion.source,
          promotedAt: promotion.promotedAt,
          decision: promotion.decision,
          previousActiveSource: promotion.previousActiveSource,
          releasePacketID: releasePacket.packetID,
          promotionMode: releasePacket.summary.promotionMode,
          authorizedPromotion: releasePacket.summary.authorizedPromotion,
          signedArchiveID: signedArchive.signedArchiveID,
        }),
        releasePacket,
        attestationPacket: QualityPromotionSignedArchiveAttestationPacket.create({
          promotion: QualityPromotionSignedArchiveAttestationPacket.PromotionReference.parse({
            promotionID: promotion.promotionID,
            source: promotion.source,
            promotedAt: promotion.promotedAt,
            decision: promotion.decision,
            previousActiveSource: promotion.previousActiveSource,
            releasePacketID: releasePacket.packetID,
            promotionMode: releasePacket.summary.promotionMode,
            authorizedPromotion: releasePacket.summary.authorizedPromotion,
            signedArchiveID: signedArchive.signedArchiveID,
          }),
          attestationRecord: record,
        }),
      })
      const dossier = QualityPromotionSignedArchiveReviewDossier.create({
        governancePacket,
        handoffPackage: signedArchive.packagedArchive.portableExport.handoffPackage,
      })
      const tamperedDossier = QualityPromotionSignedArchiveReviewDossier.DossierArtifact.parse({
        ...dossier,
        governancePacket: {
          ...dossier.governancePacket,
          promotion: {
            ...dossier.governancePacket.promotion,
            signedArchiveID: "wrong-signed-archive",
          },
        },
      })
      const promotionRecord = QualityModelRegistry.PromotionRecord.parse({
        schemaVersion: 1,
        kind: "ax-code-quality-model-promotion",
        promotionID: promotion.promotionID,
        source: promotion.source,
        promotedAt: promotion.promotedAt,
        previousActiveSource: promotion.previousActiveSource,
        decision: promotion.decision,
        benchmark: {
          baselineSource: "baseline",
          overallStatus: "pass",
          trainSessions: 2,
          evalSessions: 1,
          labeledTrainingItems: 4,
          gates: [
            {
              name: "dataset-consistency",
              status: "pass",
              detail: "ok",
            },
          ],
        },
        signedArchiveReviewDossier: {
          dossierID: dossier.dossierID,
          createdAt: dossier.createdAt,
          promotionID: dossier.governancePacket.promotion.promotionID,
          governancePacketID: dossier.governancePacket.packetID,
          packageID: dossier.handoffPackage.packageID,
          releasePacketID: dossier.summary.releasePacketID,
          signedArchiveID: dossier.summary.signedArchiveID,
          authorizedPromotion: dossier.summary.authorizedPromotion,
          promotionMode: dossier.summary.promotionMode,
          policySource: dossier.summary.policySource,
          policyProjectID: dossier.summary.policyProjectID,
          overallStatus: dossier.summary.overallStatus,
        },
      })
      await Storage.write(["quality_model_promotion", promotionRecord.promotionID], promotionRecord)

      const tamperedDossierFile = path.join(tmp.path, "tampered-signed-archive-review-dossier.json")
      await Bun.write(tamperedDossierFile, JSON.stringify(tamperedDossier, null, 2))

      const result = Bun.spawnSync({
        cmd: [
          "bun",
          "run",
          path.join(import.meta.dir, "../../script/quality-rollout.ts"),
          "--mode",
          "model-signed-archive-review-dossier-status",
          "--promotion-id",
          promotionRecord.promotionID,
          "--signed-archive-review-dossier",
          tamperedDossierFile,
        ],
        cwd: path.join(import.meta.dir, "../.."),
        env: process.env,
      })

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr.toString()).toContain(
        `Signed archive review dossier ${dossier.dossierID} for promotion ${promotionRecord.promotionID} is invalid`,
      )
    } finally {
      await clearSignedArchives()
    }
  })

  test("builds review dossier status from explicit governance packet and handoff package when no dossier is persisted", async () => {
    const { packagedArchive } = buildPackagedArchive()
    await clearSignedArchives()
    await using tmp = await tmpdir()
    try {
      const signing = {
        attestedBy: "release-integrity-bot",
        keyID: "archive-key-v1",
        keySource: "env" as const,
        keyLocator: "AX_CODE_QUALITY_ARCHIVE_KEY",
        keyMaterial: "quality-archive-secret-v1",
      }
      const signedArchive = QualityPromotionSignedArchive.create({
        packagedArchive,
        signing,
      })
      const trustEntry = QualityPromotionSignedArchiveTrust.create({
        scope: "project",
        projectID: "signed-archive-project-1",
        signing,
      })
      await QualityPromotionSignedArchiveTrust.append(trustEntry)
      const trust = await QualityPromotionSignedArchiveTrust.evaluate({
        archive: signedArchive,
        keyMaterial: signing.keyMaterial,
        projectID: "signed-archive-project-1",
      })
      const attestation = QualityPromotionSignedArchiveAttestationPolicy.evaluate({
        trust,
        policy: QualityPromotionSignedArchiveAttestationPolicy.defaults({
          minimumTrustScope: "project",
        }),
        policySource: "project",
        policyProjectID: "signed-archive-project-1",
      })
      const record = QualityPromotionSignedArchiveAttestationRecord.create({
        signedArchive,
        trust,
        attestation,
      })
      const releasePacket = signedArchive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.releasePacket
      const promotion = signedArchive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion
      const governancePacket = QualityPromotionSignedArchiveGovernancePacket.create({
        promotion: QualityPromotionSignedArchiveAttestationPacket.PromotionReference.parse({
          promotionID: promotion.promotionID,
          source: promotion.source,
          promotedAt: promotion.promotedAt,
          decision: promotion.decision,
          previousActiveSource: promotion.previousActiveSource,
          releasePacketID: releasePacket.packetID,
          promotionMode: releasePacket.summary.promotionMode,
          authorizedPromotion: releasePacket.summary.authorizedPromotion,
          signedArchiveID: signedArchive.signedArchiveID,
        }),
        releasePacket,
        attestationPacket: QualityPromotionSignedArchiveAttestationPacket.create({
          promotion: QualityPromotionSignedArchiveAttestationPacket.PromotionReference.parse({
            promotionID: promotion.promotionID,
            source: promotion.source,
            promotedAt: promotion.promotedAt,
            decision: promotion.decision,
            previousActiveSource: promotion.previousActiveSource,
            releasePacketID: releasePacket.packetID,
            promotionMode: releasePacket.summary.promotionMode,
            authorizedPromotion: releasePacket.summary.authorizedPromotion,
            signedArchiveID: signedArchive.signedArchiveID,
          }),
          attestationRecord: record,
        }),
      })
      const promotionRecord = QualityModelRegistry.PromotionRecord.parse({
        schemaVersion: 1,
        kind: "ax-code-quality-model-promotion",
        promotionID: promotion.promotionID,
        source: promotion.source,
        promotedAt: promotion.promotedAt,
        previousActiveSource: promotion.previousActiveSource,
        decision: promotion.decision,
        benchmark: {
          baselineSource: "baseline",
          overallStatus: "pass",
          trainSessions: 2,
          evalSessions: 1,
          labeledTrainingItems: 4,
          gates: [
            {
              name: "dataset-consistency",
              status: "pass",
              detail: "ok",
            },
          ],
        },
      })
      await Storage.write(["quality_model_promotion", promotionRecord.promotionID], promotionRecord)

      const governancePacketFile = path.join(tmp.path, "signed-archive-governance-packet.json")
      const handoffPackageFile = path.join(tmp.path, "handoff-package.json")
      await Bun.write(governancePacketFile, JSON.stringify(governancePacket, null, 2))
      await Bun.write(handoffPackageFile, JSON.stringify(signedArchive.packagedArchive.portableExport.handoffPackage, null, 2))

      const result = Bun.spawnSync({
        cmd: [
          "bun",
          "run",
          path.join(import.meta.dir, "../../script/quality-rollout.ts"),
          "--mode",
          "model-signed-archive-review-dossier-status",
          "--promotion-id",
          promotionRecord.promotionID,
          "--signed-archive-governance-packet",
          governancePacketFile,
          "--handoff-package",
          handoffPackageFile,
        ],
        cwd: path.join(import.meta.dir, "../.."),
        env: process.env,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toContain(`promotion id: ${promotionRecord.promotionID}`)
      expect(result.stdout.toString()).toContain(`governance packet id: ${governancePacket.packetID}`)
    } finally {
      await clearSignedArchives()
    }
  })
})
