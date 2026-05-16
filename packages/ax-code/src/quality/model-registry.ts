import z from "zod"
import { Storage } from "../storage/storage"
import { QualityPromotionAdoptionDissentHandling } from "./promotion-adoption-dissent-handling"
import { QualityPromotionAdoptionDissentResolution } from "./promotion-adoption-dissent-resolution"
import { QualityPromotionAdoptionDissentSupersession } from "./promotion-adoption-dissent-supersession"
import { QualityPromotionAdoptionReview } from "./promotion-adoption-review"
import { QualityPromotionArchiveManifest } from "./promotion-archive-manifest"
import { QualityPromotionAuditManifest } from "./promotion-audit-manifest"
import { QualityPromotionBoardDecision } from "./promotion-board-decision"
import { QualityPromotionApprovalPacket } from "./promotion-approval-packet"
import { QualityPromotionApproval } from "./promotion-approval"
import { QualityPromotionApprovalPolicy } from "./promotion-approval-policy"
import { QualityPromotionApprovalPolicyStore } from "./promotion-approval-policy-store"
import { QualityCalibrationModel } from "./calibration-model"
import { QualityPromotionDecisionBundle } from "./promotion-decision-bundle"
import { QualityPromotionExportBundle } from "./promotion-export-bundle"
import { QualityPromotionHandoffPackage } from "./promotion-handoff-package"
import { QualityPromotionEligibility } from "./promotion-eligibility"
import { QualityPromotionPackagedArchive } from "./promotion-packaged-archive"
import { QualityPromotionPortableExport } from "./promotion-portable-export"
import { QualityPromotionReleasePolicy } from "./promotion-release-policy"
import { QualityPromotionReleaseDecisionRecord } from "./promotion-release-decision-record"
import { QualityPromotionReleasePacket } from "./promotion-release-packet"
import { QualityPromotionReleasePolicyStore } from "./promotion-release-policy-store"
import { QualityPromotionReviewDossier } from "./promotion-review-dossier"
import { QualityPromotionSignedArchive } from "./promotion-signed-archive"
import { QualityPromotionSignedArchiveAttestationRecord } from "./promotion-signed-archive-attestation-record"
import { QualityPromotionSignedArchiveAttestationPacket } from "./promotion-signed-archive-attestation-packet"
import { QualityPromotionSignedArchiveGovernancePacket } from "./promotion-signed-archive-governance-packet"
import { QualityPromotionSignedArchiveReviewDossier } from "./promotion-signed-archive-review-dossier"
import { QualityPromotionSignedArchiveAttestationPolicy } from "./promotion-signed-archive-attestation-policy"
import { QualityPromotionSignedArchiveAttestationPolicyStore } from "./promotion-signed-archive-attestation-policy-store"
import { QualityPromotionSignedArchiveTrust } from "./promotion-signed-archive-trust"
import { QualityPromotionSubmissionBundle } from "./promotion-submission-bundle"
import { QualityReentryContext } from "./reentry-context"
import { QualityReentryRemediation } from "./reentry-remediation"
import { QualityPromotionWatch } from "./promotion-watch"
import { QualityStabilityGuard } from "./stability-guard"

export namespace QualityModelRegistry {
  export const PromotionMetadata = z.object({
    promotionID: z.string(),
    promotedAt: z.string(),
  })
  export type PromotionMetadata = z.output<typeof PromotionMetadata>

  export const ModelRecord = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-model-record"),
    registeredAt: z.string(),
    model: z.lazy(() => QualityCalibrationModel.ModelFile),
  })
  export type ModelRecord = z.output<typeof ModelRecord>

  export const ActiveRecord = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-model-active"),
    source: z.string(),
    activatedAt: z.string(),
  })
  export type ActiveRecord = z.output<typeof ActiveRecord>

  export const PromotionRecord = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-model-promotion"),
    promotionID: z.string(),
    source: z.string(),
    promotedAt: z.string(),
    previousActiveSource: z.string().nullable(),
    decision: z.enum(["pass", "warn_override", "force"]),
    decisionBundleCreatedAt: z.string().nullable().optional(),
    boardDecision: z
      .object({
        decisionID: z.string(),
        decidedAt: z.string(),
        decider: z.string(),
        role: z.string().nullable(),
        team: z.string().nullable().default(null),
        reportingChain: z.string().nullable().default(null),
        disposition: z.lazy(() => QualityPromotionBoardDecision.Disposition),
        overrideAccepted: z.boolean(),
        dossierID: z.string(),
        recommendation: z.lazy(() => QualityPromotionReviewDossier.Recommendation),
        requiredOverride: z.enum(["none", "allow_warn", "force"]),
        overallStatus: z.enum(["pass", "fail"]),
      })
      .optional(),
    releaseDecisionRecord: z
      .object({
        recordID: z.string(),
        recordedAt: z.string(),
        decisionID: z.string(),
        disposition: z.lazy(() => QualityPromotionBoardDecision.Disposition),
        overrideAccepted: z.boolean(),
        authorizedPromotion: z.boolean(),
        promotionMode: z.lazy(() => QualityPromotionReleaseDecisionRecord.PromotionMode),
        overallStatus: z.enum(["pass", "fail"]),
      })
      .optional(),
    releasePacket: z
      .object({
        packetID: z.string(),
        createdAt: z.string(),
        recordID: z.string(),
        decisionID: z.string(),
        authorizedPromotion: z.boolean(),
        promotionMode: z.lazy(() => QualityPromotionReleaseDecisionRecord.PromotionMode),
        overallStatus: z.enum(["pass", "fail"]),
      })
      .optional(),
    auditManifest: z
      .object({
        manifestID: z.string(),
        createdAt: z.string(),
        packetID: z.string(),
        promotionID: z.string(),
        decision: z.enum(["pass", "warn_override", "force"]),
        promotionMode: z.lazy(() => QualityPromotionReleaseDecisionRecord.PromotionMode),
        overallStatus: z.enum(["pass", "fail"]),
      })
      .optional(),
    exportBundle: z
      .object({
        bundleID: z.string(),
        createdAt: z.string(),
        manifestID: z.string(),
        packetID: z.string(),
        promotionID: z.string(),
        decision: z.enum(["pass", "warn_override", "force"]),
        promotionMode: z.lazy(() => QualityPromotionReleaseDecisionRecord.PromotionMode),
        overallStatus: z.enum(["pass", "fail"]),
      })
      .optional(),
    archiveManifest: z
      .object({
        archiveID: z.string(),
        createdAt: z.string(),
        bundleID: z.string(),
        manifestID: z.string(),
        packetID: z.string(),
        promotionID: z.string(),
        inventoryCount: z.number().int().positive(),
        promotionMode: z.lazy(() => QualityPromotionReleaseDecisionRecord.PromotionMode),
        overallStatus: z.enum(["pass", "fail"]),
      })
      .optional(),
    handoffPackage: z
      .object({
        packageID: z.string(),
        createdAt: z.string(),
        archiveID: z.string(),
        bundleID: z.string(),
        manifestID: z.string(),
        packetID: z.string(),
        promotionID: z.string(),
        documentCount: z.number().int().positive(),
        overallStatus: z.enum(["pass", "fail"]),
      })
      .optional(),
    portableExport: z
      .object({
        exportID: z.string(),
        createdAt: z.string(),
        packageID: z.string(),
        archiveID: z.string(),
        bundleID: z.string(),
        promotionID: z.string(),
        fileCount: z.number().int().positive(),
        overallStatus: z.enum(["pass", "fail"]),
      })
      .optional(),
    packagedArchive: z
      .object({
        archiveID: z.string(),
        createdAt: z.string(),
        exportID: z.string(),
        packageID: z.string(),
        promotionID: z.string(),
        entryCount: z.number().int().positive(),
        overallStatus: z.enum(["pass", "fail"]),
      })
      .optional(),
    signedArchive: z
      .object({
        signedArchiveID: z.string(),
        createdAt: z.string(),
        archiveID: z.string(),
        exportID: z.string(),
        promotionID: z.string(),
        keyID: z.string(),
        attestedBy: z.string(),
        algorithm: z.literal("hmac-sha256"),
        overallStatus: z.enum(["pass", "fail"]),
      })
      .optional(),
    signedArchiveTrust: z
      .object({
        overallStatus: z.enum(["pass", "warn", "fail"]),
        trusted: z.boolean(),
        signatureStatus: z.enum(["pass", "fail"]),
        registryStatus: z.enum(["pass", "fail"]),
        lifecycleStatus: z.enum(["pass", "warn", "fail"]),
        resolution: z.object({
          matched: z.boolean(),
          scope: z.enum(["global", "project"]).nullable(),
          projectID: z.string().nullable(),
          trustID: z.string().nullable(),
          lifecycle: z.enum(["active", "retired", "revoked"]).nullable(),
          registeredAt: z.string().nullable(),
          effectiveFrom: z.string().nullable(),
          retiredAt: z.string().nullable(),
          revokedAt: z.string().nullable(),
        }),
      })
      .optional(),
    signedArchiveAttestation: z
      .object({
        overallStatus: z.enum(["pass", "warn", "fail"]),
        policySource: z.enum(["explicit", "project", "global", "default"]),
        policyProjectID: z.string().nullable(),
        policyDigest: z.string(),
        acceptedByPolicy: z.boolean(),
        trustStatus: z.enum(["pass", "warn", "fail"]),
        minimumScopeStatus: z.enum(["pass", "fail"]),
        lifecyclePolicyStatus: z.enum(["pass", "warn", "fail"]),
        effectiveTrustScope: z.enum(["global", "project"]).nullable(),
        effectiveTrustLifecycle: z.enum(["active", "retired", "revoked"]).nullable(),
      })
      .optional(),
    signedArchiveAttestationRecord: z
      .object({
        recordID: z.string(),
        createdAt: z.string(),
        signedArchiveID: z.string(),
        promotionID: z.string(),
        trustStatus: z.enum(["pass", "warn", "fail"]),
        attestationStatus: z.enum(["pass", "warn", "fail"]),
        trusted: z.boolean(),
        acceptedByPolicy: z.boolean(),
        policySource: z.enum(["explicit", "project", "global", "default"]),
        policyProjectID: z.string().nullable(),
        overallStatus: z.enum(["pass", "warn", "fail"]),
      })
      .optional(),
    signedArchiveAttestationPacket: z
      .object({
        packetID: z.string(),
        createdAt: z.string(),
        promotionID: z.string(),
        signedArchiveID: z.string(),
        trustStatus: z.enum(["pass", "warn", "fail"]),
        attestationStatus: z.enum(["pass", "warn", "fail"]),
        acceptedByPolicy: z.boolean(),
        policySource: z.enum(["explicit", "project", "global", "default"]),
        policyProjectID: z.string().nullable(),
        overallStatus: z.enum(["pass", "warn", "fail"]),
      })
      .optional(),
    signedArchiveGovernancePacket: z
      .object({
        packetID: z.string(),
        createdAt: z.string(),
        promotionID: z.string(),
        releasePacketID: z.string(),
        signedArchiveID: z.string(),
        authorizedPromotion: z.boolean(),
        promotionMode: z.lazy(() => QualityPromotionReleaseDecisionRecord.PromotionMode),
        policySource: z.enum(["explicit", "project", "global", "default"]),
        policyProjectID: z.string().nullable(),
        overallStatus: z.enum(["pass", "warn", "fail"]),
      })
      .optional(),
    signedArchiveReviewDossier: z
      .object({
        dossierID: z.string(),
        createdAt: z.string(),
        promotionID: z.string(),
        governancePacketID: z.string(),
        packageID: z.string(),
        releasePacketID: z.string(),
        signedArchiveID: z.string(),
        authorizedPromotion: z.boolean(),
        promotionMode: z.lazy(() => QualityPromotionReleaseDecisionRecord.PromotionMode),
        policySource: z.enum(["explicit", "project", "global", "default"]),
        policyProjectID: z.string().nullable(),
        overallStatus: z.enum(["pass", "warn", "fail"]),
      })
      .optional(),
    reviewDossier: z
      .object({
        dossierID: z.string(),
        createdAt: z.string(),
        submissionID: z.string(),
        submissionCreatedAt: z.string(),
        decisionBundleCreatedAt: z.string(),
        approvalPacketID: z.string(),
        overallStatus: z.enum(["pass", "fail"]),
        recommendation: z.lazy(() => QualityPromotionReviewDossier.Recommendation),
      })
      .optional(),
    submissionBundle: z
      .object({
        submissionID: z.string(),
        createdAt: z.string(),
        decisionBundleCreatedAt: z.string(),
        approvalPacketID: z.string(),
        overallStatus: z.enum(["pass", "fail"]),
        eligibilityDecision: z.enum(["go", "review", "no_go"]),
        requiredOverride: z.enum(["none", "allow_warn", "force"]),
      })
      .optional(),
    approval: z
      .object({
        approvalID: z.string(),
        approvedAt: z.string(),
        approver: z.string(),
        role: z.string().nullable(),
        team: z.string().nullable().default(null),
        reportingChain: z.string().nullable().default(null),
        disposition: z.enum(["approved", "rejected"]),
        decisionBundleCreatedAt: z.string(),
        decisionBundleDigest: z.string(),
      })
      .optional(),
    approvalPacket: z
      .object({
        packetID: z.string(),
        createdAt: z.string(),
        decisionBundleCreatedAt: z.string(),
        decisionBundleDigest: z.string(),
        adoptionStatus: z.enum(["accepted", "partially_accepted", "diverged", "no_effective_policy"]),
        approvalCount: z.number().int().nonnegative(),
        adoptionReviewCount: z.number().int().nonnegative(),
        hasDissentHandling: z.boolean(),
        overallStatus: z.enum(["pass", "fail"]),
      })
      .optional(),
    approvals: z
      .array(
        z.object({
          approvalID: z.string(),
          approvedAt: z.string(),
          approver: z.string(),
          role: z.string().nullable(),
          team: z.string().nullable().default(null),
          reportingChain: z.string().nullable().default(null),
          disposition: z.enum(["approved", "rejected"]),
          decisionBundleCreatedAt: z.string(),
          decisionBundleDigest: z.string(),
        }),
      )
      .optional(),
    adoptionReviews: z
      .array(
        z.object({
          reviewID: z.string(),
          reviewedAt: z.string(),
          reviewer: z.string(),
          role: z.string().nullable(),
          disposition: z.lazy(() => QualityPromotionAdoptionReview.Disposition),
          rationale: z.string().nullable(),
          decisionBundleCreatedAt: z.string(),
          decisionBundleDigest: z.string(),
          suggestionDigest: z.string(),
          adoptionStatus: z.enum(["accepted", "partially_accepted", "diverged", "no_effective_policy"]),
        }),
      )
      .optional(),
    adoptionReviewConsensus: z
      .object({
        overallStatus: z.enum(["pass", "fail"]),
        adoptionStatus: z.enum(["accepted", "partially_accepted", "diverged", "no_effective_policy"]),
        qualifyingDisposition: z.lazy(() => QualityPromotionAdoptionReview.Disposition),
        requiredReviews: z.number().int().nonnegative(),
        minimumRole: z.string().nullable(),
        distinctReviewersRequired: z.boolean(),
        qualifyingReviews: z.number().int().nonnegative(),
        distinctQualifiedReviewers: z.number().int().nonnegative(),
        qualifiedRejectingReviews: z.number().int().nonnegative(),
        distinctQualifiedRejectingReviewers: z.number().int().nonnegative(),
      })
      .optional(),
    adoptionDissentResolutions: z
      .array(
        z.object({
          resolutionID: z.string(),
          resolvedAt: z.string(),
          resolver: z.string(),
          role: z.string().nullable(),
          rationale: z.string(),
          targetReviewCount: z.number().int().positive(),
          decisionBundleCreatedAt: z.string(),
          decisionBundleDigest: z.string(),
          suggestionDigest: z.string(),
          adoptionStatus: z.enum(["accepted", "partially_accepted", "diverged", "no_effective_policy"]),
        }),
      )
      .optional(),
    adoptionDissentResolution: z
      .object({
        overallStatus: z.enum(["pass", "fail"]),
        adoptionStatus: z.enum(["accepted", "partially_accepted", "diverged", "no_effective_policy"]),
        requiredRole: z.string().nullable(),
        totalResolutions: z.number().int().nonnegative(),
        qualifyingResolutions: z.number().int().nonnegative(),
        distinctQualifyingResolvers: z.number().int().nonnegative(),
        totalQualifiedRejectingReviews: z.number().int().nonnegative(),
        coveredQualifiedRejectingReviews: z.number().int().nonnegative(),
        unresolvedQualifiedRejectingReviews: z.number().int().nonnegative(),
        distinctQualifiedRejectingReviewers: z.number().int().nonnegative(),
      })
      .optional(),
    adoptionDissentSupersessions: z
      .array(
        z.object({
          supersessionID: z.string(),
          supersededAt: z.string(),
          superseder: z.string(),
          role: z.string().nullable(),
          disposition: z.lazy(() => QualityPromotionAdoptionDissentSupersession.Disposition),
          rationale: z.string(),
          targetReviewCount: z.number().int().positive(),
          decisionBundleCreatedAt: z.string(),
          decisionBundleDigest: z.string(),
          suggestionDigest: z.string(),
          adoptionStatus: z.enum(["accepted", "partially_accepted", "diverged", "no_effective_policy"]),
        }),
      )
      .optional(),
    adoptionDissentSupersession: z
      .object({
        overallStatus: z.enum(["pass", "fail"]),
        adoptionStatus: z.enum(["accepted", "partially_accepted", "diverged", "no_effective_policy"]),
        requiredRole: z.string().nullable(),
        totalSupersessions: z.number().int().nonnegative(),
        qualifyingSupersessions: z.number().int().nonnegative(),
        distinctQualifyingSuperseders: z.number().int().nonnegative(),
        totalQualifiedRejectingReviews: z.number().int().nonnegative(),
        coveredQualifiedRejectingReviews: z.number().int().nonnegative(),
        unresolvedQualifiedRejectingReviews: z.number().int().nonnegative(),
        coveredByReviewerRereview: z.number().int().nonnegative(),
        coveredByEvidenceSupersession: z.number().int().nonnegative(),
      })
      .optional(),
    adoptionDissentHandlingBundle: z
      .object({
        handlingID: z.string(),
        handledAt: z.string(),
        decisionBundleCreatedAt: z.string(),
        decisionBundleDigest: z.string(),
        suggestionDigest: z.string(),
        adoptionStatus: z.enum(["accepted", "partially_accepted", "diverged", "no_effective_policy"]),
        qualifiedRejectingReviewCount: z.number().int().nonnegative(),
        resolutionCount: z.number().int().nonnegative(),
        supersessionCount: z.number().int().nonnegative(),
      })
      .optional(),
    adoptionDissentHandling: z.lazy(() => QualityPromotionAdoptionDissentHandling.HandlingSummary).optional(),
    approvalPolicy: z
      .object({
        policySource: z.lazy(() => QualityPromotionApprovalPolicy.PolicySource),
        policyProjectID: z.string().nullable(),
        overallStatus: z.enum(["pass", "fail"]),
        requiredOverride: z.enum(["none", "allow_warn", "force"]),
        requiredApprovals: z.number().int().nonnegative(),
        minimumRole: z.string().nullable(),
        distinctApproversRequired: z.boolean(),
        independentReviewRequired: z.boolean(),
        priorApproverExclusionRequired: z.boolean(),
        maxPriorApproverOverlapRatio: z.number().min(0).max(1).nullable(),
        reviewerCarryoverBudget: z.number().nonnegative().nullable(),
        reviewerCarryoverLookbackPromotions: z.number().int().positive().nullable(),
        teamCarryoverBudget: z.number().nonnegative().nullable(),
        teamCarryoverLookbackPromotions: z.number().int().positive().nullable(),
        maxPriorReportingChainOverlapRatio: z.number().min(0).max(1).nullable(),
        reportingChainCarryoverBudget: z.number().nonnegative().nullable(),
        reportingChainCarryoverLookbackPromotions: z.number().int().positive().nullable(),
        roleCohortDiversityRequired: z.boolean(),
        minimumDistinctRoleCohorts: z.number().int().positive().nullable(),
        reviewerTeamDiversityRequired: z.boolean(),
        minimumDistinctReviewerTeams: z.number().int().positive().nullable(),
        reportingChainDiversityRequired: z.boolean(),
        minimumDistinctReportingChains: z.number().int().positive().nullable(),
        qualifiedApprovals: z.number().int().nonnegative(),
        independentQualifiedApprovals: z.number().int().nonnegative(),
        freshQualifiedApprovals: z.number().int().nonnegative(),
        overlappingQualifiedApprovers: z.number().int().nonnegative(),
        priorApproverOverlapRatio: z.number().min(0).max(1).nullable(),
        reviewerCarryoverScore: z.number().nonnegative(),
        carriedOverQualifiedApprovers: z.number().int().nonnegative(),
        teamCarryoverScore: z.number().nonnegative(),
        carriedOverQualifiedTeams: z.number().int().nonnegative(),
        overlappingQualifiedReportingChains: z.number().int().nonnegative(),
        priorReportingChainOverlapRatio: z.number().min(0).max(1).nullable(),
        reportingChainCarryoverScore: z.number().nonnegative(),
        carriedOverQualifiedReportingChains: z.number().int().nonnegative(),
        distinctQualifiedRoleCohorts: z.number().int().nonnegative(),
        distinctQualifiedReviewerTeams: z.number().int().nonnegative(),
        missingQualifiedReviewerTeams: z.number().int().nonnegative(),
        distinctQualifiedReportingChains: z.number().int().nonnegative(),
        missingQualifiedReportingChains: z.number().int().nonnegative(),
        approverReuseRatio: z.number().min(0).max(1).nullable(),
        teamReuseRatio: z.number().min(0).max(1).nullable(),
        reportingChainReuseRatio: z.number().min(0).max(1).nullable(),
        approvalConcentrationBudget: z.number().min(0).max(1).nullable(),
        approvalConcentrationPreset: z
          .lazy(() => QualityPromotionApprovalPolicy.ApprovalConcentrationPreset)
          .nullable(),
        approvalConcentrationWeights: z.object({
          approver: z.number().min(0),
          team: z.number().min(0),
          reportingChain: z.number().min(0),
        }),
        approvalConcentrationScore: z.number().min(0).max(1).nullable(),
        approvalConcentrationApplicableAxes: z.array(z.enum(["approver", "team", "reporting_chain"])),
        approvalConcentrationAppliedWeightTotal: z.number().positive().nullable(),
        distinctQualifiedApprovers: z.number().int().nonnegative(),
        priorPromotionApprovers: z.number().int().nonnegative(),
        priorPromotionReportingChains: z.number().int().nonnegative(),
      })
      .optional(),
    releasePolicy: z
      .object({
        policySource: z.enum(["explicit", "project", "global", "default"]),
        policyProjectID: z.string().nullable(),
        compatibilityApprovalSource: z.enum(["project", "global", "default"]).nullable(),
        resolvedAt: z.string(),
        persistedScope: z.enum(["global", "project"]).nullable(),
        persistedUpdatedAt: z.string().nullable(),
        digest: z.string(),
        policy: z.lazy(() => QualityPromotionReleasePolicy.Policy),
      })
      .optional(),
    approvalPolicySuggestion: z.lazy(() => QualityPromotionDecisionBundle.ApprovalPolicySuggestionSnapshot).optional(),
    benchmark: z.object({
      baselineSource: z.string(),
      overallStatus: z.enum(["pass", "warn", "fail"]),
      trainSessions: z.number().int().nonnegative(),
      evalSessions: z.number().int().nonnegative(),
      labeledTrainingItems: z.number().int().nonnegative(),
      gates: z.array(
        z.object({
          name: z.string(),
          status: z.enum(["pass", "warn", "fail"]),
          detail: z.string(),
        }),
      ),
    }),
    eligibility: z.lazy(() => QualityPromotionEligibility.EligibilitySummary).optional(),
    stability: z.lazy(() => QualityStabilityGuard.StabilitySummary).optional(),
  })
  export type PromotionRecord = z.output<typeof PromotionRecord>

  export const CanonicalPromotionStage = z.enum([
    "model_promoted",
    "review_governed",
    "release_authorized",
    "signed_and_evaluated",
    "post_signing_reviewed",
  ])
  export type CanonicalPromotionStage = z.output<typeof CanonicalPromotionStage>

  export const CanonicalPromotionArtifactKind = z.enum([
    "promotion_record",
    "review_dossier",
    "release_packet",
    "signed_archive_review_dossier",
  ])
  export type CanonicalPromotionArtifactKind = z.output<typeof CanonicalPromotionArtifactKind>

  export const CanonicalPromotionSummary = z.object({
    promotionID: z.string(),
    source: z.string(),
    decision: z.enum(["pass", "warn_override", "force"]),
    currentStage: CanonicalPromotionStage,
    overallStatus: z.enum(["pass", "warn", "fail"]),
    canonicalArtifactKind: CanonicalPromotionArtifactKind,
    canonicalArtifactID: z.string(),
    reviewGoverned: z.boolean(),
    releaseAuthorized: z.boolean(),
    signedArchivePresent: z.boolean(),
    attestationAccepted: z.boolean().nullable(),
    postSigningReviewed: z.boolean(),
    policySource: z.enum(["explicit", "project", "global", "default"]).nullable(),
    policyProjectID: z.string().nullable(),
    nextAction: z.string().nullable(),
    gaps: z.array(z.string()),
    artifacts: z.object({
      reviewDossierID: z.string().nullable(),
      boardDecisionID: z.string().nullable(),
      releasePacketID: z.string().nullable(),
      signedArchiveID: z.string().nullable(),
      signedArchiveAttestationRecordID: z.string().nullable(),
      signedArchiveReviewDossierID: z.string().nullable(),
      handoffPackageID: z.string().nullable(),
      packagedArchiveID: z.string().nullable(),
    }),
  })
  export type CanonicalPromotionSummary = z.output<typeof CanonicalPromotionSummary>

  export const RollbackRecord = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-model-rollback"),
    rollbackID: z.string(),
    source: z.string(),
    rolledBackAt: z.string(),
    promotionID: z.string(),
    promotedAt: z.string(),
    previousActiveSource: z.string().nullable(),
    rollbackTargetSource: z.string().nullable(),
    resultingActiveSource: z.string().nullable(),
    decision: z.enum(["fail_guard", "warn_override", "force"]),
    reentryContextID: z.string().nullable().optional(),
    watch: z.object({
      overallStatus: z.enum(["pass", "warn", "fail"]),
      totalRecords: z.number().int().nonnegative(),
      sessionsCovered: z.number().int().nonnegative(),
      releasePolicy: z
        .object({
          policySource: z.enum(["explicit", "project", "global", "default"]),
          policyProjectID: z.string().nullable(),
          compatibilityApprovalSource: z.enum(["project", "global", "default"]).nullable(),
          resolvedAt: z.string(),
          persistedScope: z.enum(["global", "project"]).nullable(),
          persistedUpdatedAt: z.string().nullable(),
          digest: z.string(),
        })
        .optional(),
      gates: z.array(
        z.object({
          name: z.string(),
          status: z.enum(["pass", "warn", "fail"]),
          detail: z.string(),
        }),
      ),
    }),
    stability: z.lazy(() => QualityStabilityGuard.StabilitySummary).optional(),
  })
  export type RollbackRecord = z.output<typeof RollbackRecord>

  function canonicalPromotionOverallStatus(record: PromotionRecord): CanonicalPromotionSummary["overallStatus"] {
    return (
      record.signedArchiveReviewDossier?.overallStatus ??
      record.signedArchiveAttestationRecord?.overallStatus ??
      record.signedArchiveAttestation?.overallStatus ??
      record.signedArchive?.overallStatus ??
      record.releasePacket?.overallStatus ??
      record.reviewDossier?.overallStatus ??
      record.benchmark.overallStatus
    )
  }

  export function summarizeCanonicalPromotion(record: PromotionRecord) {
    const reviewGoverned = Boolean(record.reviewDossier || record.boardDecision || record.releaseDecisionRecord)
    const releaseAuthorized = Boolean(record.releasePacket?.authorizedPromotion)
    const signedArchivePresent = Boolean(record.signedArchive)
    const attestationAccepted =
      record.signedArchiveAttestation?.acceptedByPolicy ??
      record.signedArchiveAttestationRecord?.acceptedByPolicy ??
      null
    const postSigningReviewed = Boolean(record.signedArchiveReviewDossier)
    const currentStage: CanonicalPromotionSummary["currentStage"] = postSigningReviewed
      ? "post_signing_reviewed"
      : signedArchivePresent
        ? "signed_and_evaluated"
        : releaseAuthorized
          ? "release_authorized"
          : reviewGoverned
            ? "review_governed"
            : "model_promoted"
    const canonicalArtifactKind: CanonicalPromotionSummary["canonicalArtifactKind"] = postSigningReviewed
      ? "signed_archive_review_dossier"
      : record.releasePacket
        ? "release_packet"
        : record.reviewDossier
          ? "review_dossier"
          : "promotion_record"
    const canonicalArtifactID = postSigningReviewed
      ? record.signedArchiveReviewDossier!.dossierID
      : record.releasePacket
        ? record.releasePacket.packetID
        : record.reviewDossier
          ? record.reviewDossier.dossierID
          : record.promotionID

    const gaps: string[] = []
    if (!reviewGoverned) {
      gaps.push("Pre-release review governance is missing.")
    }
    if (reviewGoverned && !record.releasePacket) {
      gaps.push("Release packet is missing.")
    }
    if (record.releasePacket && !record.signedArchive) {
      gaps.push("Signed archive is missing.")
    }
    if (record.signedArchive && !record.signedArchiveAttestationRecord) {
      gaps.push("Signed archive attestation record is missing.")
    }
    if (record.signedArchive && attestationAccepted === false) {
      gaps.push("Signed archive is not accepted by the resolved attestation policy.")
    }
    if (record.signedArchive && !record.signedArchiveReviewDossier) {
      gaps.push("Post-signing review dossier is missing.")
    }

    const nextAction = !reviewGoverned
      ? "Advance this promotion through the pre-release review path before treating it as releasable."
      : !record.releasePacket
        ? "Create a release packet to freeze release authorization and operator intent."
        : !record.signedArchive
          ? "Create and verify a signed archive from the release packet."
          : attestationAccepted === false
            ? "Resolve signed archive trust or attestation policy mismatches before distribution."
            : !record.signedArchiveReviewDossier
              ? "Build the signed archive review dossier so post-signing review has a canonical entry point."
              : null

    return CanonicalPromotionSummary.parse({
      promotionID: record.promotionID,
      source: record.source,
      decision: record.decision,
      currentStage,
      overallStatus: canonicalPromotionOverallStatus(record),
      canonicalArtifactKind,
      canonicalArtifactID,
      reviewGoverned,
      releaseAuthorized,
      signedArchivePresent,
      attestationAccepted,
      postSigningReviewed,
      policySource:
        record.signedArchiveReviewDossier?.policySource ??
        record.signedArchiveAttestationRecord?.policySource ??
        record.signedArchiveAttestation?.policySource ??
        null,
      policyProjectID:
        record.signedArchiveReviewDossier?.policyProjectID ??
        record.signedArchiveAttestationRecord?.policyProjectID ??
        record.signedArchiveAttestation?.policyProjectID ??
        null,
      nextAction,
      gaps,
      artifacts: {
        reviewDossierID: record.reviewDossier?.dossierID ?? null,
        boardDecisionID: record.boardDecision?.decisionID ?? null,
        releasePacketID: record.releasePacket?.packetID ?? null,
        signedArchiveID: record.signedArchive?.signedArchiveID ?? null,
        signedArchiveAttestationRecordID: record.signedArchiveAttestationRecord?.recordID ?? null,
        signedArchiveReviewDossierID: record.signedArchiveReviewDossier?.dossierID ?? null,
        handoffPackageID: record.handoffPackage?.packageID ?? null,
        packagedArchiveID: record.packagedArchive?.archiveID ?? null,
      },
    })
  }

  export function renderCanonicalPromotionReport(input: PromotionRecord | CanonicalPromotionSummary) {
    const summary = "kind" in input ? summarizeCanonicalPromotion(input) : input
    const lines: string[] = []
    lines.push("## ax-code quality promotion canonical summary")
    lines.push("")
    lines.push(`- source: ${summary.source}`)
    lines.push(`- promotion id: ${summary.promotionID}`)
    lines.push(`- decision: ${summary.decision}`)
    lines.push(`- current stage: ${summary.currentStage}`)
    lines.push(`- overall status: ${summary.overallStatus}`)
    lines.push(`- canonical artifact: ${summary.canonicalArtifactKind} · ${summary.canonicalArtifactID}`)
    lines.push(`- review governed: ${summary.reviewGoverned}`)
    lines.push(`- release authorized: ${summary.releaseAuthorized}`)
    lines.push(`- signed archive present: ${summary.signedArchivePresent}`)
    lines.push(`- attestation accepted: ${summary.attestationAccepted === null ? "n/a" : summary.attestationAccepted}`)
    lines.push(`- post-signing reviewed: ${summary.postSigningReviewed}`)
    lines.push(`- policy source: ${summary.policySource ?? "n/a"}`)
    lines.push(`- policy project id: ${summary.policyProjectID ?? "n/a"}`)
    lines.push(`- next action: ${summary.nextAction ?? "none"}`)
    lines.push("")
    lines.push("### Canonical Artifacts")
    lines.push("")
    lines.push(`- review dossier: ${summary.artifacts.reviewDossierID ?? "missing"}`)
    lines.push(`- board decision: ${summary.artifacts.boardDecisionID ?? "missing"}`)
    lines.push(`- release packet: ${summary.artifacts.releasePacketID ?? "missing"}`)
    lines.push(`- signed archive: ${summary.artifacts.signedArchiveID ?? "missing"}`)
    lines.push(
      `- signed archive attestation record: ${summary.artifacts.signedArchiveAttestationRecordID ?? "missing"}`,
    )
    lines.push(`- signed archive review dossier: ${summary.artifacts.signedArchiveReviewDossierID ?? "missing"}`)
    lines.push(`- handoff package: ${summary.artifacts.handoffPackageID ?? "missing"}`)
    lines.push(`- packaged archive: ${summary.artifacts.packagedArchiveID ?? "missing"}`)
    lines.push("")
    lines.push("### Gaps")
    lines.push("")
    if (summary.gaps.length === 0) {
      lines.push("- none")
    } else {
      for (const gap of summary.gaps) {
        lines.push(`- ${gap}`)
      }
    }
    lines.push("")
    return lines.join("\n")
  }

  function encode(input: string) {
    return encodeURIComponent(input)
  }

  function decode(input: string) {
    return decodeURIComponent(input)
  }

  function normalizeReportingChain(reportingChain: string | null | undefined) {
    const normalized = reportingChain?.trim().toLowerCase()
    return normalized ? normalized : null
  }

  function normalizeTeam(team: string | null | undefined) {
    const normalized = team?.trim().toLowerCase()
    return normalized ? normalized : null
  }

  function modelKey(source: string) {
    return ["quality_model", encode(source)]
  }

  function activeKey() {
    return ["quality_model_active", "current"]
  }

  function promotionKey(promotionID: string) {
    return ["quality_model_promotion", promotionID]
  }

  function rollbackKey(rollbackID: string) {
    return ["quality_model_rollback", rollbackID]
  }

  function sort(records: ModelRecord[]) {
    return [...records].sort((a, b) => {
      const byRegisteredAt = a.registeredAt.localeCompare(b.registeredAt)
      if (byRegisteredAt !== 0) return byRegisteredAt
      return a.model.source.localeCompare(b.model.source)
    })
  }

  export async function get(source: string) {
    const record = await Storage.read<unknown>(modelKey(source))
    return ModelRecord.parse(record)
  }

  export async function register(model: QualityCalibrationModel.ModelFile) {
    const next = ModelRecord.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-model-record",
      registeredAt: new Date().toISOString(),
      model,
    })

    try {
      const existing = await get(model.source)
      const prev = JSON.stringify(existing.model)
      const curr = JSON.stringify(model)
      if (prev === curr) return existing
      throw new Error(`Model source ${model.source} already exists with different content`)
    } catch (err) {
      if (!Storage.NotFoundError.isInstance(err)) throw err
      await Storage.write(modelKey(model.source), next)
      return next
    }
  }

  export async function list() {
    const keys = await Storage.list(["quality_model"])
    const out: ModelRecord[] = []
    for (const parts of keys) {
      const encodedSource = parts[parts.length - 1]
      if (!encodedSource) continue
      out.push(await get(decode(encodedSource)))
    }
    return sort(out)
  }

  export async function getActive() {
    try {
      const record = await Storage.read<unknown>(activeKey())
      return ActiveRecord.parse(record)
    } catch (err) {
      if (Storage.NotFoundError.isInstance(err)) return
      throw err
    }
  }

  export async function activate(source: string) {
    await get(source)
    const next = ActiveRecord.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-model-active",
      source,
      activatedAt: new Date().toISOString(),
    })
    await Storage.write(activeKey(), next)
    return next
  }

  export async function clearActive() {
    await Storage.remove(activeKey())
  }

  export async function resolveActiveModel() {
    const active = await getActive()
    if (!active) return
    return (await get(active.source)).model
  }

  export async function listPromotions(source?: string) {
    const keys = await Storage.list(["quality_model_promotion"])
    const out: PromotionRecord[] = []
    for (const parts of keys) {
      const promotionID = parts[parts.length - 1]
      if (!promotionID) continue
      const record = PromotionRecord.parse(await Storage.read<unknown>(promotionKey(promotionID)))
      if (source && record.source !== source) continue
      out.push(record)
    }
    return out.sort((a, b) => a.promotedAt.localeCompare(b.promotedAt) || a.source.localeCompare(b.source))
  }

  export async function latestPromotion(source?: string) {
    const promotions = await listPromotions(source)
    return promotions[promotions.length - 1]
  }

  export async function getPromotion(promotionID: string) {
    const record = await Storage.read<unknown>(promotionKey(promotionID))
    return PromotionRecord.parse(record)
  }

  function auditManifestPromotionSnapshot(record: PromotionRecord): QualityPromotionAuditManifest.PromotionSnapshot {
    return QualityPromotionAuditManifest.PromotionSnapshot.parse({
      promotionID: record.promotionID,
      source: record.source,
      promotedAt: record.promotedAt,
      previousActiveSource: record.previousActiveSource,
      decision: record.decision,
      decisionBundleCreatedAt: record.decisionBundleCreatedAt ?? null,
      boardDecision: record.boardDecision,
      releaseDecisionRecord: record.releaseDecisionRecord,
      releasePacket: record.releasePacket,
      reviewDossier: record.reviewDossier,
      submissionBundle: record.submissionBundle,
      approvalPacket: record.approvalPacket,
      signedArchiveTrust: record.signedArchiveTrust,
      signedArchiveAttestation: record.signedArchiveAttestation,
    })
  }

  function createPromotionMetadata(source: string): PromotionMetadata {
    return PromotionMetadata.parse({
      promotionID: `${Date.now()}-${encode(source)}`,
      promotedAt: new Date().toISOString(),
    })
  }

  function buildReleasePacketPromotionSnapshot(input: {
    releasePacket: QualityPromotionReleasePacket.PacketArtifact
    promotionMetadata: PromotionMetadata
    previousActiveSource: string | null
    decision: "pass" | "warn_override" | "force"
  }) {
    const boardDecision = input.releasePacket.releaseDecisionRecord.boardDecision
    const reviewDossier = boardDecision.reviewDossier
    const submissionBundle = reviewDossier.submissionBundle
    const approvalPacket = submissionBundle.approvalPacket
    return QualityPromotionAuditManifest.PromotionSnapshot.parse({
      promotionID: input.promotionMetadata.promotionID,
      source: input.releasePacket.source,
      promotedAt: input.promotionMetadata.promotedAt,
      previousActiveSource: input.previousActiveSource,
      decision: input.decision,
      decisionBundleCreatedAt: submissionBundle.decisionBundle.createdAt,
      boardDecision: {
        decisionID: boardDecision.decisionID,
        decidedAt: boardDecision.decidedAt,
        decider: boardDecision.decider,
        role: boardDecision.role,
        team: boardDecision.team ?? null,
        reportingChain: boardDecision.reportingChain ?? null,
        disposition: boardDecision.disposition,
        overrideAccepted: boardDecision.overrideAccepted,
        dossierID: reviewDossier.dossierID,
        recommendation: boardDecision.summary.recommendation,
        requiredOverride: boardDecision.summary.requiredOverride,
        overallStatus: boardDecision.summary.overallStatus,
      },
      releaseDecisionRecord: {
        recordID: input.releasePacket.releaseDecisionRecord.recordID,
        recordedAt: input.releasePacket.releaseDecisionRecord.recordedAt,
        decisionID: boardDecision.decisionID,
        disposition: input.releasePacket.releaseDecisionRecord.summary.disposition,
        overrideAccepted: input.releasePacket.releaseDecisionRecord.summary.overrideAccepted,
        authorizedPromotion: input.releasePacket.releaseDecisionRecord.summary.authorizedPromotion,
        promotionMode: input.releasePacket.releaseDecisionRecord.summary.promotionMode,
        overallStatus: input.releasePacket.releaseDecisionRecord.summary.overallStatus,
      },
      releasePacket: {
        packetID: input.releasePacket.packetID,
        createdAt: input.releasePacket.createdAt,
        recordID: input.releasePacket.releaseDecisionRecord.recordID,
        decisionID: boardDecision.decisionID,
        authorizedPromotion: input.releasePacket.summary.authorizedPromotion,
        promotionMode: input.releasePacket.summary.promotionMode,
        overallStatus: input.releasePacket.summary.overallStatus,
      },
      reviewDossier: {
        dossierID: reviewDossier.dossierID,
        createdAt: reviewDossier.createdAt,
        submissionID: submissionBundle.submissionID,
        submissionCreatedAt: submissionBundle.createdAt,
        decisionBundleCreatedAt: submissionBundle.decisionBundle.createdAt,
        approvalPacketID: approvalPacket.packetID,
        overallStatus: reviewDossier.summary.overallStatus,
        recommendation: reviewDossier.summary.recommendation,
      },
      submissionBundle: {
        submissionID: submissionBundle.submissionID,
        createdAt: submissionBundle.createdAt,
        decisionBundleCreatedAt: submissionBundle.decisionBundle.createdAt,
        approvalPacketID: approvalPacket.packetID,
        overallStatus: submissionBundle.summary.overallStatus,
        eligibilityDecision: submissionBundle.summary.eligibilityDecision,
        requiredOverride: submissionBundle.summary.requiredOverride,
      },
      approvalPacket: {
        packetID: approvalPacket.packetID,
        createdAt: approvalPacket.createdAt,
        decisionBundleCreatedAt: approvalPacket.decisionBundle.createdAt,
        decisionBundleDigest: approvalPacket.decisionBundle.digest,
        adoptionStatus: approvalPacket.readiness.adoptionStatus,
        approvalCount: approvalPacket.readiness.totalApprovals,
        adoptionReviewCount: approvalPacket.readiness.totalAdoptionReviews,
        hasDissentHandling: !!approvalPacket.dissentHandling,
        overallStatus: approvalPacket.readiness.overallStatus,
      },
    })
  }

  function releasePacketAttestationProjectID(releasePacket: QualityPromotionReleasePacket.PacketArtifact) {
    return (
      releasePacket.releaseDecisionRecord.boardDecision.reviewDossier.submissionBundle.decisionBundle.releasePolicy?.provenance.policyProjectID?.trim() ||
      null
    )
  }

  export async function listRollbacks(source?: string) {
    const keys = await Storage.list(["quality_model_rollback"])
    const out: RollbackRecord[] = []
    for (const parts of keys) {
      const rollbackID = parts[parts.length - 1]
      if (!rollbackID) continue
      const record = RollbackRecord.parse(await Storage.read<unknown>(rollbackKey(rollbackID)))
      if (source && record.source !== source) continue
      out.push(record)
    }
    return out.sort((a, b) => a.rolledBackAt.localeCompare(b.rolledBackAt) || a.source.localeCompare(b.source))
  }

  export async function evaluatePromotionEligibility(
    bundle: QualityCalibrationModel.BenchmarkBundle,
    options?: {
      cooldownHours?: number
      repeatFailureWindowHours?: number
      repeatFailureThreshold?: number
      releasePolicyDigest?: string | null
      reviewerCarryoverLookbackPromotions?: number | null
      teamCarryoverLookbackPromotions?: number | null
      reportingChainCarryoverLookbackPromotions?: number | null
    },
  ) {
    const [currentActive, promotions, rollbacks, reentryContext] = await Promise.all([
      getActive(),
      listPromotions(bundle.model.source),
      listRollbacks(bundle.model.source),
      QualityReentryContext.latest(bundle.model.source),
    ])
    const priorPromotion = reentryContext
      ? await getPromotion(reentryContext.promotionID).catch((err) => {
          if (Storage.NotFoundError.isInstance(err)) return undefined
          throw err
        })
      : undefined
    const priorPromotionApprovers = [
      ...new Set([
        ...(priorPromotion?.approvals?.map((approval) => approval.approver) ?? []),
        ...(priorPromotion?.approval ? [priorPromotion.approval.approver] : []),
      ]),
    ].sort()
    const priorPromotionReportingChains = [
      ...new Set([
        ...(priorPromotion?.approvals
          ?.map((approval) => normalizeReportingChain(approval.reportingChain))
          .filter((value): value is string => value !== null) ?? []),
        ...(priorPromotion?.approval
          ? [normalizeReportingChain(priorPromotion.approval.reportingChain)].filter(
              (value): value is string => value !== null,
            )
          : []),
      ]),
    ].sort()
    const reviewerCarryoverLookbackPromotions = options?.reviewerCarryoverLookbackPromotions ?? 3
    const teamCarryoverLookbackPromotions = options?.teamCarryoverLookbackPromotions ?? 3
    const reportingChainCarryoverLookbackPromotions = options?.reportingChainCarryoverLookbackPromotions ?? 3
    const reviewerCarryoverHistory = promotions
      .filter((promotion) => promotion.eligibility?.reentryContext)
      .slice(-reviewerCarryoverLookbackPromotions)
      .reverse()
      .reduce((map, promotion, index) => {
        const weight = 1 / 2 ** index
        const approvers = [
          ...new Set([
            ...(promotion.approvals?.map((approval) => approval.approver) ?? []),
            ...(promotion.approval ? [promotion.approval.approver] : []),
          ]),
        ].sort()
        for (const approver of approvers) {
          const existing = map.get(approver)
          if (existing) {
            existing.weightedReuseScore += weight
            existing.appearances += 1
            continue
          }
          map.set(approver, {
            approver,
            weightedReuseScore: weight,
            appearances: 1,
            mostRecentPromotionID: promotion.promotionID,
            mostRecentPromotedAt: promotion.promotedAt,
          })
        }
        return map
      }, new Map<string, QualityPromotionEligibility.ReviewerCarryoverEntry>())
    const normalizedReviewerCarryoverHistory = [...reviewerCarryoverHistory.values()].sort((a, b) => {
      const byScore = b.weightedReuseScore - a.weightedReuseScore
      if (byScore !== 0) return byScore
      return a.approver.localeCompare(b.approver)
    })
    const teamCarryoverHistory = promotions
      .filter((promotion) => promotion.eligibility?.reentryContext)
      .slice(-teamCarryoverLookbackPromotions)
      .reverse()
      .reduce((map, promotion, index) => {
        const weight = 1 / 2 ** index
        const teams = [
          ...new Set([
            ...(promotion.approvals
              ?.map((approval) => normalizeTeam(approval.team))
              .filter((value): value is string => value !== null) ?? []),
            ...(promotion.approval
              ? [normalizeTeam(promotion.approval.team)].filter((value): value is string => value !== null)
              : []),
          ]),
        ].sort()
        for (const team of teams) {
          const existing = map.get(team)
          if (existing) {
            existing.weightedReuseScore += weight
            existing.appearances += 1
            continue
          }
          map.set(team, {
            team,
            weightedReuseScore: weight,
            appearances: 1,
            mostRecentPromotionID: promotion.promotionID,
            mostRecentPromotedAt: promotion.promotedAt,
          })
        }
        return map
      }, new Map<string, QualityPromotionEligibility.TeamCarryoverEntry>())
    const normalizedTeamCarryoverHistory = [...teamCarryoverHistory.values()].sort((a, b) => {
      const byScore = b.weightedReuseScore - a.weightedReuseScore
      if (byScore !== 0) return byScore
      return a.team.localeCompare(b.team)
    })
    const reportingChainCarryoverHistory = promotions
      .filter((promotion) => promotion.eligibility?.reentryContext)
      .slice(-reportingChainCarryoverLookbackPromotions)
      .reverse()
      .reduce((map, promotion, index) => {
        const weight = 1 / 2 ** index
        const reportingChains = [
          ...new Set([
            ...(promotion.approvals
              ?.map((approval) => normalizeReportingChain(approval.reportingChain))
              .filter((value): value is string => value !== null) ?? []),
            ...(promotion.approval
              ? [normalizeReportingChain(promotion.approval.reportingChain)].filter(
                  (value): value is string => value !== null,
                )
              : []),
          ]),
        ].sort()
        for (const reportingChain of reportingChains) {
          const existing = map.get(reportingChain)
          if (existing) {
            existing.weightedReuseScore += weight
            existing.appearances += 1
            continue
          }
          map.set(reportingChain, {
            reportingChain,
            weightedReuseScore: weight,
            appearances: 1,
            mostRecentPromotionID: promotion.promotionID,
            mostRecentPromotedAt: promotion.promotedAt,
          })
        }
        return map
      }, new Map<string, QualityPromotionEligibility.ReportingChainCarryoverEntry>())
    const normalizedReportingChainCarryoverHistory = [...reportingChainCarryoverHistory.values()].sort((a, b) => {
      const byScore = b.weightedReuseScore - a.weightedReuseScore
      if (byScore !== 0) return byScore
      return a.reportingChain.localeCompare(b.reportingChain)
    })
    const reentryRemediation = reentryContext
      ? await QualityReentryRemediation.latestForContext({
          source: bundle.model.source,
          contextID: reentryContext.contextID,
        })
      : undefined
    const stability = QualityStabilityGuard.summarize({
      source: bundle.model.source,
      rollbacks,
      cooldownHours: options?.cooldownHours,
      repeatFailureWindowHours: options?.repeatFailureWindowHours,
      repeatFailureThreshold: options?.repeatFailureThreshold,
    })
    const eligibility = QualityPromotionEligibility.summarize({
      bundle,
      stability,
      currentActiveSource: currentActive?.source ?? null,
      lastPromotionAt: promotions[promotions.length - 1]?.promotedAt ?? null,
      lastRollbackAt: rollbacks[rollbacks.length - 1]?.rolledBackAt ?? null,
      priorPromotions: promotions.length,
      priorRollbacks: rollbacks.length,
      reentryContext,
      remediation: reentryRemediation,
      priorPromotionApprovers,
      teamCarryoverHistory: normalizedTeamCarryoverHistory,
      priorPromotionReportingChains,
      reviewerCarryoverHistory: normalizedReviewerCarryoverHistory,
      reportingChainCarryoverHistory: normalizedReportingChainCarryoverHistory,
      currentReleasePolicyDigest: options?.releasePolicyDigest ?? null,
    })
    return {
      currentActive,
      promotions,
      rollbacks,
      priorPromotion,
      reentryContext,
      reentryRemediation,
      stability,
      eligibility,
    }
  }

  export async function buildPromotionDecisionBundle(
    bundle: QualityCalibrationModel.BenchmarkBundle,
    options?: {
      cooldownHours?: number
      repeatFailureWindowHours?: number
      repeatFailureThreshold?: number
      releasePolicyResolution?: QualityPromotionReleasePolicyStore.Resolution
    },
  ) {
    const evaluation = await evaluatePromotionEligibility(bundle, {
      ...options,
      reviewerCarryoverLookbackPromotions:
        options?.releasePolicyResolution?.policy?.approval?.rules?.reentry?.reviewerCarryoverLookbackPromotions,
      teamCarryoverLookbackPromotions:
        options?.releasePolicyResolution?.policy?.approval?.rules?.reentry?.teamCarryoverLookbackPromotions,
      reportingChainCarryoverLookbackPromotions:
        options?.releasePolicyResolution?.policy?.approval?.rules?.reentry?.reportingChainCarryoverLookbackPromotions,
    })
    const decisionBundle = QualityPromotionDecisionBundle.build({
      benchmark: bundle,
      stability: evaluation.stability,
      eligibility: evaluation.eligibility,
      policy: {
        cooldownHours: options?.cooldownHours,
        repeatFailureWindowHours: options?.repeatFailureWindowHours,
        repeatFailureThreshold: options?.repeatFailureThreshold,
      },
      releasePolicySnapshot: options?.releasePolicyResolution
        ? {
            policy: options.releasePolicyResolution.policy,
            provenance: QualityPromotionReleasePolicyStore.provenance(options.releasePolicyResolution),
          }
        : undefined,
    })
    return { ...evaluation, decisionBundle }
  }

  function finalizePromotion(input: {
    bundle: QualityCalibrationModel.BenchmarkBundle
    currentActive: ActiveRecord | undefined
    eligibility: QualityPromotionEligibility.EligibilitySummary
    stability: QualityStabilityGuard.StabilitySummary
    force?: boolean
    promotionMetadata?: PromotionMetadata
    decisionBundleCreatedAt?: string | null
    submissionBundle?: QualityPromotionSubmissionBundle.BundleArtifact
    approval?: QualityPromotionApproval.ApprovalArtifact
    approvalPacket?: QualityPromotionApprovalPacket.PacketArtifact
    approvals?: QualityPromotionApproval.ApprovalArtifact[]
    adoptionReviews?: QualityPromotionAdoptionReview.ReviewArtifact[]
    adoptionReviewConsensus?: QualityPromotionAdoptionReview.ConsensusSummary
    adoptionDissentResolutions?: QualityPromotionAdoptionDissentResolution.ResolutionArtifact[]
    adoptionDissentResolution?: QualityPromotionAdoptionDissentResolution.ResolutionSummary
    adoptionDissentSupersessions?: QualityPromotionAdoptionDissentSupersession.SupersessionArtifact[]
    adoptionDissentSupersession?: QualityPromotionAdoptionDissentSupersession.SupersessionSummary
    adoptionDissentHandlingBundle?: QualityPromotionAdoptionDissentHandling.HandlingArtifact
    adoptionDissentHandling?: QualityPromotionAdoptionDissentHandling.HandlingSummary
    approvalEvaluation?: QualityPromotionApprovalPolicy.EvaluationSummary
    releasePolicy?: QualityPromotionDecisionBundle.ReleasePolicySnapshot
    approvalPolicySuggestion?: QualityPromotionDecisionBundle.ApprovalPolicySuggestionSnapshot
  }) {
    return (async () => {
      const registered = await register(input.bundle.model)
      const previousActive = input.currentActive
      const active = await activate(input.bundle.model.source)
      const decision = input.force
        ? "force"
        : input.eligibility.requiredOverride === "allow_warn"
          ? "warn_override"
          : "pass"
      const promotedAt = input.promotionMetadata?.promotedAt ?? new Date().toISOString()
      const promotionID = input.promotionMetadata?.promotionID ?? `${Date.now()}-${encode(input.bundle.model.source)}`
      const record = PromotionRecord.parse({
        schemaVersion: 1,
        kind: "ax-code-quality-model-promotion",
        promotionID,
        source: input.bundle.model.source,
        promotedAt,
        previousActiveSource: previousActive?.source ?? null,
        decision,
        decisionBundleCreatedAt: input.decisionBundleCreatedAt ?? null,
        submissionBundle: input.submissionBundle
          ? {
              submissionID: input.submissionBundle.submissionID,
              createdAt: input.submissionBundle.createdAt,
              decisionBundleCreatedAt: input.submissionBundle.decisionBundle.createdAt,
              approvalPacketID: input.submissionBundle.approvalPacket.packetID,
              overallStatus: input.submissionBundle.summary.overallStatus,
              eligibilityDecision: input.submissionBundle.summary.eligibilityDecision,
              requiredOverride: input.submissionBundle.summary.requiredOverride,
            }
          : undefined,
        approval: input.approval
          ? {
              approvalID: input.approval.approvalID,
              approvedAt: input.approval.approvedAt,
              approver: input.approval.approver,
              role: input.approval.role,
              team: input.approval.team ?? null,
              reportingChain: input.approval.reportingChain ?? null,
              disposition: input.approval.disposition,
              decisionBundleCreatedAt: input.approval.decisionBundle.createdAt,
              decisionBundleDigest: input.approval.decisionBundle.digest,
            }
          : undefined,
        approvalPacket: input.approvalPacket
          ? {
              packetID: input.approvalPacket.packetID,
              createdAt: input.approvalPacket.createdAt,
              decisionBundleCreatedAt: input.approvalPacket.decisionBundle.createdAt,
              decisionBundleDigest: input.approvalPacket.decisionBundle.digest,
              adoptionStatus: input.approvalPacket.suggestion.adoptionStatus,
              approvalCount: input.approvalPacket.approvals.length,
              adoptionReviewCount: input.approvalPacket.adoptionReviews.length,
              hasDissentHandling: !!input.approvalPacket.dissentHandling,
              overallStatus: input.approvalPacket.readiness.overallStatus,
            }
          : undefined,
        approvals: input.approvals?.map((approval) => ({
          approvalID: approval.approvalID,
          approvedAt: approval.approvedAt,
          approver: approval.approver,
          role: approval.role,
          team: approval.team ?? null,
          reportingChain: approval.reportingChain ?? null,
          disposition: approval.disposition,
          decisionBundleCreatedAt: approval.decisionBundle.createdAt,
          decisionBundleDigest: approval.decisionBundle.digest,
        })),
        adoptionReviews: input.adoptionReviews?.map((review) => ({
          reviewID: review.reviewID,
          reviewedAt: review.reviewedAt,
          reviewer: review.reviewer,
          role: review.role,
          disposition: review.disposition,
          rationale: review.rationale,
          decisionBundleCreatedAt: review.decisionBundle.createdAt,
          decisionBundleDigest: review.decisionBundle.digest,
          suggestionDigest: review.suggestion.digest,
          adoptionStatus: review.suggestion.adoptionStatus,
        })),
        adoptionReviewConsensus: input.adoptionReviewConsensus
          ? {
              overallStatus: input.adoptionReviewConsensus.overallStatus,
              adoptionStatus: input.adoptionReviewConsensus.adoptionStatus,
              qualifyingDisposition: input.adoptionReviewConsensus.qualifyingDisposition,
              requiredReviews: input.adoptionReviewConsensus.requirement.minimumReviews,
              minimumRole: input.adoptionReviewConsensus.requirement.minimumRole,
              distinctReviewersRequired: input.adoptionReviewConsensus.requirement.requireDistinctReviewers,
              qualifyingReviews: input.adoptionReviewConsensus.qualifyingReviews,
              distinctQualifiedReviewers: input.adoptionReviewConsensus.distinctQualifiedReviewers,
              qualifiedRejectingReviews: input.adoptionReviewConsensus.qualifiedRejectingReviews,
              distinctQualifiedRejectingReviewers: input.adoptionReviewConsensus.distinctQualifiedRejectingReviewers,
            }
          : undefined,
        adoptionDissentResolutions: input.adoptionDissentResolutions?.map((resolution) => ({
          resolutionID: resolution.resolutionID,
          resolvedAt: resolution.resolvedAt,
          resolver: resolution.resolver,
          role: resolution.role,
          rationale: resolution.rationale,
          targetReviewCount: resolution.targetReviews.length,
          decisionBundleCreatedAt: resolution.decisionBundle.createdAt,
          decisionBundleDigest: resolution.decisionBundle.digest,
          suggestionDigest: resolution.suggestion.digest,
          adoptionStatus: resolution.suggestion.adoptionStatus,
        })),
        adoptionDissentResolution: input.adoptionDissentResolution
          ? {
              overallStatus: input.adoptionDissentResolution.overallStatus,
              adoptionStatus: input.adoptionDissentResolution.adoptionStatus,
              requiredRole: input.adoptionDissentResolution.requiredRole,
              totalResolutions: input.adoptionDissentResolution.totalResolutions,
              qualifyingResolutions: input.adoptionDissentResolution.qualifyingResolutions,
              distinctQualifyingResolvers: input.adoptionDissentResolution.distinctQualifyingResolvers,
              totalQualifiedRejectingReviews: input.adoptionDissentResolution.totalQualifiedRejectingReviews,
              coveredQualifiedRejectingReviews: input.adoptionDissentResolution.coveredQualifiedRejectingReviews,
              unresolvedQualifiedRejectingReviews: input.adoptionDissentResolution.unresolvedQualifiedRejectingReviews,
              distinctQualifiedRejectingReviewers: input.adoptionDissentResolution.distinctQualifiedRejectingReviewers,
            }
          : undefined,
        adoptionDissentSupersessions: input.adoptionDissentSupersessions?.map((supersession) => ({
          supersessionID: supersession.supersessionID,
          supersededAt: supersession.supersededAt,
          superseder: supersession.superseder,
          role: supersession.role,
          disposition: supersession.disposition,
          rationale: supersession.rationale,
          targetReviewCount: supersession.targetReviews.length,
          decisionBundleCreatedAt: supersession.decisionBundle.createdAt,
          decisionBundleDigest: supersession.decisionBundle.digest,
          suggestionDigest: supersession.suggestion.digest,
          adoptionStatus: supersession.suggestion.adoptionStatus,
        })),
        adoptionDissentSupersession: input.adoptionDissentSupersession
          ? {
              overallStatus: input.adoptionDissentSupersession.overallStatus,
              adoptionStatus: input.adoptionDissentSupersession.adoptionStatus,
              requiredRole: input.adoptionDissentSupersession.requiredRole,
              totalSupersessions: input.adoptionDissentSupersession.totalSupersessions,
              qualifyingSupersessions: input.adoptionDissentSupersession.qualifyingSupersessions,
              distinctQualifyingSuperseders: input.adoptionDissentSupersession.distinctQualifyingSuperseders,
              totalQualifiedRejectingReviews: input.adoptionDissentSupersession.totalQualifiedRejectingReviews,
              coveredQualifiedRejectingReviews: input.adoptionDissentSupersession.coveredQualifiedRejectingReviews,
              unresolvedQualifiedRejectingReviews:
                input.adoptionDissentSupersession.unresolvedQualifiedRejectingReviews,
              coveredByReviewerRereview: input.adoptionDissentSupersession.coveredByReviewerRereview,
              coveredByEvidenceSupersession: input.adoptionDissentSupersession.coveredByEvidenceSupersession,
            }
          : undefined,
        adoptionDissentHandlingBundle: input.adoptionDissentHandlingBundle
          ? {
              handlingID: input.adoptionDissentHandlingBundle.handlingID,
              handledAt: input.adoptionDissentHandlingBundle.handledAt,
              decisionBundleCreatedAt: input.adoptionDissentHandlingBundle.decisionBundle.createdAt,
              decisionBundleDigest: input.adoptionDissentHandlingBundle.decisionBundle.digest,
              suggestionDigest: input.adoptionDissentHandlingBundle.suggestion.digest,
              adoptionStatus: input.adoptionDissentHandlingBundle.suggestion.adoptionStatus,
              qualifiedRejectingReviewCount: input.adoptionDissentHandlingBundle.qualifiedRejectingReviews.length,
              resolutionCount: input.adoptionDissentHandlingBundle.resolutions.length,
              supersessionCount: input.adoptionDissentHandlingBundle.supersessions.length,
            }
          : undefined,
        adoptionDissentHandling: input.adoptionDissentHandling ?? undefined,
        approvalPolicy: input.approvalEvaluation
          ? {
              overallStatus: input.approvalEvaluation.overallStatus,
              policySource: input.approvalEvaluation.policySource,
              policyProjectID: input.approvalEvaluation.policyProjectID,
              requiredOverride: input.approvalEvaluation.requiredOverride,
              requiredApprovals: input.approvalEvaluation.requirement.minimumApprovals,
              minimumRole: input.approvalEvaluation.requirement.minimumRole,
              distinctApproversRequired: input.approvalEvaluation.requirement.requireDistinctApprovers,
              independentReviewRequired: input.approvalEvaluation.independentReviewRequired,
              priorApproverExclusionRequired: input.approvalEvaluation.priorApproverExclusionRequired,
              maxPriorApproverOverlapRatio: input.approvalEvaluation.maxPriorApproverOverlapRatio,
              reviewerCarryoverBudget: input.approvalEvaluation.reviewerCarryoverBudget,
              reviewerCarryoverLookbackPromotions: input.approvalEvaluation.reviewerCarryoverLookbackPromotions,
              teamCarryoverBudget: input.approvalEvaluation.teamCarryoverBudget,
              teamCarryoverLookbackPromotions: input.approvalEvaluation.teamCarryoverLookbackPromotions,
              maxPriorReportingChainOverlapRatio: input.approvalEvaluation.maxPriorReportingChainOverlapRatio,
              reportingChainCarryoverBudget: input.approvalEvaluation.reportingChainCarryoverBudget,
              reportingChainCarryoverLookbackPromotions:
                input.approvalEvaluation.reportingChainCarryoverLookbackPromotions,
              roleCohortDiversityRequired: input.approvalEvaluation.roleCohortDiversityRequired,
              minimumDistinctRoleCohorts: input.approvalEvaluation.minimumDistinctRoleCohorts,
              reviewerTeamDiversityRequired: input.approvalEvaluation.reviewerTeamDiversityRequired,
              minimumDistinctReviewerTeams: input.approvalEvaluation.minimumDistinctReviewerTeams,
              reportingChainDiversityRequired: input.approvalEvaluation.reportingChainDiversityRequired,
              minimumDistinctReportingChains: input.approvalEvaluation.minimumDistinctReportingChains,
              qualifiedApprovals: input.approvalEvaluation.qualifiedApprovals,
              independentQualifiedApprovals: input.approvalEvaluation.independentQualifiedApprovals,
              freshQualifiedApprovals: input.approvalEvaluation.freshQualifiedApprovals,
              overlappingQualifiedApprovers: input.approvalEvaluation.overlappingQualifiedApprovers,
              priorApproverOverlapRatio: input.approvalEvaluation.priorApproverOverlapRatio,
              reviewerCarryoverScore: input.approvalEvaluation.reviewerCarryoverScore,
              carriedOverQualifiedApprovers: input.approvalEvaluation.carriedOverQualifiedApprovers,
              teamCarryoverScore: input.approvalEvaluation.teamCarryoverScore,
              carriedOverQualifiedTeams: input.approvalEvaluation.carriedOverQualifiedTeams,
              overlappingQualifiedReportingChains: input.approvalEvaluation.overlappingQualifiedReportingChains,
              priorReportingChainOverlapRatio: input.approvalEvaluation.priorReportingChainOverlapRatio,
              reportingChainCarryoverScore: input.approvalEvaluation.reportingChainCarryoverScore,
              carriedOverQualifiedReportingChains: input.approvalEvaluation.carriedOverQualifiedReportingChains,
              distinctQualifiedRoleCohorts: input.approvalEvaluation.distinctQualifiedRoleCohorts,
              distinctQualifiedReviewerTeams: input.approvalEvaluation.distinctQualifiedReviewerTeams,
              missingQualifiedReviewerTeams: input.approvalEvaluation.missingQualifiedReviewerTeams,
              distinctQualifiedReportingChains: input.approvalEvaluation.distinctQualifiedReportingChains,
              missingQualifiedReportingChains: input.approvalEvaluation.missingQualifiedReportingChains,
              approverReuseRatio: input.approvalEvaluation.approverReuseRatio,
              teamReuseRatio: input.approvalEvaluation.teamReuseRatio,
              reportingChainReuseRatio: input.approvalEvaluation.reportingChainReuseRatio,
              approvalConcentrationBudget: input.approvalEvaluation.approvalConcentrationBudget,
              approvalConcentrationPreset: input.approvalEvaluation.approvalConcentrationPreset,
              approvalConcentrationWeights: input.approvalEvaluation.approvalConcentrationWeights,
              approvalConcentrationScore: input.approvalEvaluation.approvalConcentrationScore,
              approvalConcentrationApplicableAxes: input.approvalEvaluation.approvalConcentrationApplicableAxes,
              approvalConcentrationAppliedWeightTotal: input.approvalEvaluation.approvalConcentrationAppliedWeightTotal,
              distinctQualifiedApprovers: input.approvalEvaluation.distinctQualifiedApprovers,
              priorPromotionApprovers: input.approvalEvaluation.priorPromotionApprovers.length,
              priorPromotionReportingChains: input.approvalEvaluation.priorPromotionReportingChains.length,
            }
          : undefined,
        releasePolicy: input.releasePolicy
          ? {
              policySource: input.releasePolicy.provenance.policySource,
              policyProjectID: input.releasePolicy.provenance.policyProjectID,
              compatibilityApprovalSource: input.releasePolicy.provenance.compatibilityApprovalSource,
              resolvedAt: input.releasePolicy.provenance.resolvedAt,
              persistedScope: input.releasePolicy.provenance.persistedScope,
              persistedUpdatedAt: input.releasePolicy.provenance.persistedUpdatedAt,
              digest: input.releasePolicy.provenance.digest,
              policy: input.releasePolicy.policy,
            }
          : undefined,
        approvalPolicySuggestion: input.approvalPolicySuggestion,
        benchmark: {
          baselineSource: input.bundle.comparison.baselineSource,
          overallStatus: input.bundle.comparison.overallStatus,
          trainSessions: input.bundle.split.trainSessionIDs.length,
          evalSessions: input.bundle.split.evalSessionIDs.length,
          labeledTrainingItems: input.bundle.model.training.labeledItems,
          gates: input.bundle.comparison.gates,
        },
        eligibility: input.eligibility,
        stability: input.stability,
      })
      await Storage.write(promotionKey(promotionID), record)
      return { registered, active, record, stability: input.stability, eligibility: input.eligibility }
    })()
  }

  function requireReentryApprovalPath(input: {
    source: string
    eligibility: QualityPromotionEligibility.EligibilitySummary
    releasePolicy?: QualityPromotionDecisionBundle.ReleasePolicySnapshot
  }) {
    if (!input.eligibility.reentryContext) return
    const resolved = QualityPromotionApprovalPolicy.resolveRequirement({
      bundle: {
        source: input.source,
        createdAt: new Date().toISOString(),
        eligibility: input.eligibility,
      },
      policy: input.releasePolicy?.policy.approval,
    })
    if (
      resolved.reentryRequirement &&
      (resolved.reentryRequirement.minimumApprovals > 0 ||
        resolved.reentryRequirement.requireIndependentReviewer ||
        resolved.reentryRequirement.requirePriorApproverExclusion ||
        resolved.reentryRequirement.maxPriorApproverOverlapRatio !== null ||
        resolved.reentryRequirement.reviewerCarryoverBudget !== null ||
        resolved.reentryRequirement.teamCarryoverBudget !== null ||
        resolved.reentryRequirement.maxPriorReportingChainOverlapRatio !== null ||
        resolved.reentryRequirement.reportingChainCarryoverBudget !== null ||
        resolved.reentryRequirement.requireRoleCohortDiversity ||
        resolved.reentryRequirement.minimumDistinctRoleCohorts !== null ||
        resolved.reentryRequirement.requireReviewerTeamDiversity ||
        resolved.reentryRequirement.minimumDistinctReviewerTeams !== null ||
        resolved.reentryRequirement.requireReportingChainDiversity ||
        resolved.reentryRequirement.minimumDistinctReportingChains !== null ||
        resolved.reentryRequirement.approvalConcentrationBudget !== null)
    ) {
      throw new Error(
        `Cannot promote model ${input.source}: reentry promotion requires approved decision bundle(s) (${resolved.reentryRequirement.minimumApprovals} approval(s), minimum role ${resolved.reentryRequirement.minimumRole ?? "none"})`,
      )
    }
  }

  export async function promote(
    bundle: QualityCalibrationModel.BenchmarkBundle,
    options?: {
      allowWarn?: boolean
      force?: boolean
      promotionMetadata?: PromotionMetadata
      cooldownHours?: number
      repeatFailureWindowHours?: number
      repeatFailureThreshold?: number
      releasePolicy?: QualityPromotionDecisionBundle.ReleasePolicySnapshot
    },
  ) {
    const { currentActive, stability, eligibility } = await evaluatePromotionEligibility(bundle, {
      ...options,
      releasePolicyDigest: options?.releasePolicy?.provenance.digest ?? null,
      reviewerCarryoverLookbackPromotions:
        options?.releasePolicy?.policy?.approval?.rules?.reentry?.reviewerCarryoverLookbackPromotions,
      teamCarryoverLookbackPromotions:
        options?.releasePolicy?.policy?.approval?.rules?.reentry?.teamCarryoverLookbackPromotions,
      reportingChainCarryoverLookbackPromotions:
        options?.releasePolicy?.policy?.approval?.rules?.reentry?.reportingChainCarryoverLookbackPromotions,
    })
    if (eligibility.requiredOverride === "force" && !options?.force) {
      throw new Error(
        `Cannot promote model ${bundle.model.source}: ${QualityPromotionEligibility.blockingReason(eligibility) ?? "force override required"}`,
      )
    }
    if (eligibility.requiredOverride === "allow_warn" && !options?.allowWarn && !options?.force) {
      throw new Error(
        `Cannot promote model ${bundle.model.source}: ${QualityPromotionEligibility.reviewReason(eligibility) ?? "allowWarn or force required"} (use allowWarn or force)`,
      )
    }
    requireReentryApprovalPath({
      source: bundle.model.source,
      eligibility,
      releasePolicy: options?.releasePolicy,
    })
    const approvalPolicySuggestion = QualityPromotionDecisionBundle.deriveApprovalPolicySuggestion({
      benchmark: bundle,
      eligibility,
      snapshot: {
        currentActiveSource: eligibility.currentActiveSource,
        lastPromotionAt: eligibility.lastPromotionAt,
        lastRollbackAt: eligibility.lastRollbackAt,
        priorPromotions: eligibility.history.priorPromotions,
        priorRollbacks: eligibility.history.priorRollbacks,
      },
      releasePolicy: options?.releasePolicy,
    })
    return finalizePromotion({
      bundle,
      currentActive,
      eligibility,
      stability,
      force: options?.force,
      promotionMetadata: options?.promotionMetadata,
      releasePolicy: options?.releasePolicy,
      approvalPolicySuggestion,
    })
  }

  export async function promoteDecisionBundle(
    decisionBundle: QualityPromotionDecisionBundle.DecisionBundle,
    options?: {
      allowWarn?: boolean
      force?: boolean
      promotionMetadata?: PromotionMetadata
      releasePolicyResolution?: QualityPromotionReleasePolicyStore.Resolution
    },
  ) {
    const evaluation = await evaluatePromotionEligibility(decisionBundle.benchmark, {
      ...decisionBundle.policy,
      releasePolicyDigest: decisionBundle.releasePolicy?.provenance.digest ?? null,
      reviewerCarryoverLookbackPromotions:
        decisionBundle.releasePolicy?.policy?.approval?.rules?.reentry?.reviewerCarryoverLookbackPromotions,
      teamCarryoverLookbackPromotions:
        decisionBundle.releasePolicy?.policy?.approval?.rules?.reentry?.teamCarryoverLookbackPromotions,
      reportingChainCarryoverLookbackPromotions:
        decisionBundle.releasePolicy?.policy?.approval?.rules?.reentry?.reportingChainCarryoverLookbackPromotions,
    })
    const drift = QualityPromotionDecisionBundle.driftReasons(decisionBundle, {
      ...evaluation,
      releasePolicy: options?.releasePolicyResolution
        ? {
            policy: options.releasePolicyResolution.policy,
            provenance: QualityPromotionReleasePolicyStore.provenance(options.releasePolicyResolution),
          }
        : undefined,
    })
    if (drift.length > 0 && !options?.force) {
      throw new Error(`Cannot promote model ${decisionBundle.source}: decision bundle is stale (${drift[0]})`)
    }
    if (evaluation.eligibility.requiredOverride === "force" && !options?.force) {
      throw new Error(
        `Cannot promote model ${decisionBundle.source}: ${QualityPromotionEligibility.blockingReason(evaluation.eligibility) ?? "force override required"}`,
      )
    }
    if (evaluation.eligibility.requiredOverride === "allow_warn" && !options?.allowWarn && !options?.force) {
      throw new Error(
        `Cannot promote model ${decisionBundle.source}: ${QualityPromotionEligibility.reviewReason(evaluation.eligibility) ?? "allowWarn or force required"} (use allowWarn or force)`,
      )
    }
    requireReentryApprovalPath({
      source: decisionBundle.source,
      eligibility: evaluation.eligibility,
      releasePolicy: decisionBundle.releasePolicy,
    })
    return finalizePromotion({
      bundle: decisionBundle.benchmark,
      currentActive: evaluation.currentActive,
      eligibility: evaluation.eligibility,
      stability: evaluation.stability,
      force: options?.force,
      promotionMetadata: options?.promotionMetadata,
      decisionBundleCreatedAt: decisionBundle.createdAt,
      releasePolicy: decisionBundle.releasePolicy,
      approvalPolicySuggestion:
        decisionBundle.approvalPolicySuggestion ??
        QualityPromotionDecisionBundle.deriveApprovalPolicySuggestion(decisionBundle),
    })
  }

  export async function promoteApprovedDecisionBundle(
    decisionBundle: QualityPromotionDecisionBundle.DecisionBundle,
    approvalInput?: QualityPromotionApproval.ApprovalArtifact | QualityPromotionApproval.ApprovalArtifact[],
    options?: {
      allowWarn?: boolean
      force?: boolean
      promotionMetadata?: PromotionMetadata
      approvalPacket?: QualityPromotionApprovalPacket.PacketArtifact | QualityPromotionApprovalPacket.PacketArtifact[]
      adoptionReviews?: QualityPromotionAdoptionReview.ReviewArtifact | QualityPromotionAdoptionReview.ReviewArtifact[]
      dissentHandling?:
        | QualityPromotionAdoptionDissentHandling.HandlingArtifact
        | QualityPromotionAdoptionDissentHandling.HandlingArtifact[]
      dissentResolutions?:
        | QualityPromotionAdoptionDissentResolution.ResolutionArtifact
        | QualityPromotionAdoptionDissentResolution.ResolutionArtifact[]
      dissentSupersessions?:
        | QualityPromotionAdoptionDissentSupersession.SupersessionArtifact
        | QualityPromotionAdoptionDissentSupersession.SupersessionArtifact[]
      approvalPolicy?: QualityPromotionApprovalPolicy.Policy
      approvalPolicySource?: QualityPromotionApprovalPolicy.PolicySource
      projectID?: string | null
      releasePolicyResolution?: QualityPromotionReleasePolicyStore.Resolution
    },
  ) {
    const approvalPackets = options?.approvalPacket
      ? Array.isArray(options.approvalPacket)
        ? options.approvalPacket
        : [options.approvalPacket]
      : []
    if (approvalPackets.length > 1) {
      throw new Error(`Cannot promote model ${decisionBundle.source}: provide at most one approval packet`)
    }
    const directApprovals = approvalInput ? (Array.isArray(approvalInput) ? approvalInput : [approvalInput]) : []
    if (approvalPackets.length > 0 && directApprovals.length > 0) {
      throw new Error(
        `Cannot promote model ${decisionBundle.source}: approval packet cannot be combined with direct approval artifacts`,
      )
    }

    let approvalPacket: QualityPromotionApprovalPacket.PacketArtifact | undefined
    let approvals: QualityPromotionApproval.ApprovalArtifact[] = []
    let resolvedAdoptionReviews: QualityPromotionAdoptionReview.ReviewArtifact[] = []
    let adoptionReviewConsensus: QualityPromotionAdoptionReview.ConsensusSummary
    let adoptionDissentHandlingBundle: QualityPromotionAdoptionDissentHandling.HandlingArtifact | undefined
    let resolvedDissentResolutions: QualityPromotionAdoptionDissentResolution.ResolutionArtifact[] = []
    let resolvedDissentSupersessions: QualityPromotionAdoptionDissentSupersession.SupersessionArtifact[] = []
    let adoptionDissentHandling: QualityPromotionAdoptionDissentHandling.HandlingSummary
    let approvalEvaluation: QualityPromotionApprovalPolicy.EvaluationSummary

    if (approvalPackets.length > 0) {
      approvalPacket = approvalPackets[0]
      const packetReasons = QualityPromotionApprovalPacket.verify(decisionBundle, approvalPacket)
      if (packetReasons.length > 0) {
        throw new Error(`Cannot promote model ${decisionBundle.source}: invalid approval packet (${packetReasons[0]})`)
      }
      await QualityPromotionApprovalPacket.assertPersisted(approvalPacket)
      if (approvalPacket.readiness.overallStatus !== "pass") {
        throw new Error(
          `Cannot promote model ${decisionBundle.source}: approval packet readiness not satisfied (${approvalPacket.readiness.gates.find((gate) => gate.status === "fail")?.detail ?? "unknown failure"})`,
        )
      }
      approvals = approvalPacket.approvals
      resolvedAdoptionReviews = approvalPacket.adoptionReviews
      adoptionReviewConsensus = approvalPacket.adoptionReviewConsensus
      adoptionDissentHandlingBundle = approvalPacket.dissentHandling
      resolvedDissentResolutions = approvalPacket.dissentHandling?.resolutions ?? []
      resolvedDissentSupersessions = approvalPacket.dissentHandling?.supersessions ?? []
      adoptionDissentHandling =
        approvalPacket.dissentHandling?.summary ??
        QualityPromotionAdoptionDissentHandling.evaluate(decisionBundle, resolvedAdoptionReviews, [], [])
      approvalEvaluation = approvalPacket.approvalEvaluation
    } else {
      approvals = directApprovals
      if (approvals.length === 0) {
        throw new Error(
          `Cannot promote model ${decisionBundle.source}: at least one approval artifact or approval packet is required`,
        )
      }
      for (const approval of approvals) {
        const approvalReasons = QualityPromotionApproval.verify(decisionBundle, approval)
        if (approvalReasons.length > 0) {
          throw new Error(
            `Cannot promote model ${decisionBundle.source}: invalid approval artifact (${approvalReasons[0]})`,
          )
        }
        await QualityPromotionApproval.assertPersisted(approval)
      }
      const adoptionReviews = options?.adoptionReviews
        ? Array.isArray(options.adoptionReviews)
          ? options.adoptionReviews
          : [options.adoptionReviews]
        : []
      for (const review of adoptionReviews) {
        const reviewReasons = QualityPromotionAdoptionReview.verify(decisionBundle, review)
        if (reviewReasons.length > 0) {
          throw new Error(
            `Cannot promote model ${decisionBundle.source}: invalid adoption review artifact (${reviewReasons[0]})`,
          )
        }
        await QualityPromotionAdoptionReview.assertPersisted(review)
      }
      resolvedAdoptionReviews = await QualityPromotionAdoptionReview.resolveForBundle(decisionBundle, adoptionReviews)
      adoptionReviewConsensus = QualityPromotionAdoptionReview.evaluate(decisionBundle, resolvedAdoptionReviews)
      const blockingConsensusGate = adoptionReviewConsensus.gates.find(
        (gate) => gate.status === "fail" && gate.name !== "qualified-rejection-veto",
      )
      if (blockingConsensusGate) {
        throw new Error(
          `Cannot promote model ${decisionBundle.source}: adoption review consensus not satisfied (${blockingConsensusGate.detail})`,
        )
      }
      const dissentHandlingBundles = options?.dissentHandling
        ? Array.isArray(options.dissentHandling)
          ? options.dissentHandling
          : [options.dissentHandling]
        : []
      if (dissentHandlingBundles.length > 1) {
        throw new Error(`Cannot promote model ${decisionBundle.source}: provide at most one dissent handling bundle`)
      }

      if (dissentHandlingBundles.length > 0) {
        const handlingBundle = dissentHandlingBundles[0]!
        const handlingReasons = QualityPromotionAdoptionDissentHandling.verify(
          decisionBundle,
          resolvedAdoptionReviews,
          handlingBundle,
        )
        if (handlingReasons.length > 0) {
          throw new Error(
            `Cannot promote model ${decisionBundle.source}: invalid adoption dissent handling bundle (${handlingReasons[0]})`,
          )
        }
        await QualityPromotionAdoptionDissentHandling.assertPersisted(handlingBundle)
        adoptionDissentHandlingBundle = handlingBundle
        resolvedDissentResolutions = handlingBundle.resolutions
        resolvedDissentSupersessions = handlingBundle.supersessions
      } else {
        const dissentResolutions = options?.dissentResolutions
          ? Array.isArray(options.dissentResolutions)
            ? options.dissentResolutions
            : [options.dissentResolutions]
          : []
        for (const resolution of dissentResolutions) {
          const resolutionReasons = QualityPromotionAdoptionDissentResolution.verify(decisionBundle, resolution)
          if (resolutionReasons.length > 0) {
            throw new Error(
              `Cannot promote model ${decisionBundle.source}: invalid adoption dissent resolution artifact (${resolutionReasons[0]})`,
            )
          }
          await QualityPromotionAdoptionDissentResolution.assertPersisted(resolution)
        }
        resolvedDissentResolutions = await QualityPromotionAdoptionDissentResolution.resolveForBundle(
          decisionBundle,
          dissentResolutions,
        )

        const dissentSupersessions = options?.dissentSupersessions
          ? Array.isArray(options.dissentSupersessions)
            ? options.dissentSupersessions
            : [options.dissentSupersessions]
          : []
        for (const supersession of dissentSupersessions) {
          const supersessionReasons = QualityPromotionAdoptionDissentSupersession.verify(decisionBundle, supersession)
          if (supersessionReasons.length > 0) {
            throw new Error(
              `Cannot promote model ${decisionBundle.source}: invalid adoption dissent supersession artifact (${supersessionReasons[0]})`,
            )
          }
          await QualityPromotionAdoptionDissentSupersession.assertPersisted(supersession)
        }
        resolvedDissentSupersessions = await QualityPromotionAdoptionDissentSupersession.resolveForBundle(
          decisionBundle,
          dissentSupersessions,
        )
      }

      adoptionDissentHandling =
        adoptionDissentHandlingBundle?.summary ??
        QualityPromotionAdoptionDissentHandling.evaluate(
          decisionBundle,
          resolvedAdoptionReviews,
          resolvedDissentResolutions,
          resolvedDissentSupersessions,
        )
      const policyResolution = await QualityPromotionApprovalPolicyStore.resolve({
        projectID: options?.projectID ?? null,
        policy: options?.approvalPolicy,
      })
      approvalEvaluation = QualityPromotionApprovalPolicy.evaluate({
        bundle: decisionBundle,
        approvals,
        policy: policyResolution.policy,
        policySource: options?.approvalPolicySource ?? policyResolution.source,
        policyProjectID: policyResolution.projectID,
      })
    }

    const adoptionDissentResolution = QualityPromotionAdoptionDissentResolution.evaluate(
      decisionBundle,
      resolvedAdoptionReviews,
      resolvedDissentResolutions,
    )
    const adoptionDissentSupersession = QualityPromotionAdoptionDissentSupersession.evaluate(
      decisionBundle,
      resolvedAdoptionReviews,
      resolvedDissentSupersessions,
    )
    const coveredByResolution = QualityPromotionAdoptionDissentResolution.coveredQualifiedRejectingReviewIDs(
      decisionBundle,
      resolvedAdoptionReviews,
      resolvedDissentResolutions,
    ).coveredReviewIDs
    const coveredBySupersession = QualityPromotionAdoptionDissentSupersession.coveredQualifiedRejectingReviewIDs(
      decisionBundle,
      resolvedAdoptionReviews,
      resolvedDissentSupersessions,
    ).coveredReviewIDs
    const combinedDissentCoverage = new Set([...coveredByResolution, ...coveredBySupersession])
    if (combinedDissentCoverage.size < adoptionReviewConsensus.qualifiedRejectingReviews) {
      throw new Error(
        `Cannot promote model ${decisionBundle.source}: adoption dissent handling not satisfied (${combinedDissentCoverage.size}/${adoptionReviewConsensus.qualifiedRejectingReviews} qualified rejecting review(s) resolved or superseded)`,
      )
    }
    if (approvalEvaluation.overallStatus !== "pass") {
      throw new Error(
        `Cannot promote model ${decisionBundle.source}: approval policy not satisfied (${approvalEvaluation.gates.find((gate) => gate.status === "fail")?.detail ?? "unknown failure"})`,
      )
    }

    const evaluation = await evaluatePromotionEligibility(decisionBundle.benchmark, {
      ...decisionBundle.policy,
      releasePolicyDigest: decisionBundle.releasePolicy?.provenance.digest ?? null,
      reviewerCarryoverLookbackPromotions:
        decisionBundle.releasePolicy?.policy?.approval?.rules?.reentry?.reviewerCarryoverLookbackPromotions,
      teamCarryoverLookbackPromotions:
        decisionBundle.releasePolicy?.policy?.approval?.rules?.reentry?.teamCarryoverLookbackPromotions,
      reportingChainCarryoverLookbackPromotions:
        decisionBundle.releasePolicy?.policy?.approval?.rules?.reentry?.reportingChainCarryoverLookbackPromotions,
    })
    const drift = QualityPromotionDecisionBundle.driftReasons(decisionBundle, {
      ...evaluation,
      releasePolicy: options?.releasePolicyResolution
        ? {
            policy: options.releasePolicyResolution.policy,
            provenance: QualityPromotionReleasePolicyStore.provenance(options.releasePolicyResolution),
          }
        : undefined,
    })
    if (drift.length > 0 && !options?.force) {
      throw new Error(`Cannot promote model ${decisionBundle.source}: decision bundle is stale (${drift[0]})`)
    }
    if (evaluation.eligibility.requiredOverride === "force" && !options?.force) {
      throw new Error(
        `Cannot promote model ${decisionBundle.source}: ${QualityPromotionEligibility.blockingReason(evaluation.eligibility) ?? "force override required"}`,
      )
    }
    if (evaluation.eligibility.requiredOverride === "allow_warn" && !options?.allowWarn && !options?.force) {
      throw new Error(
        `Cannot promote model ${decisionBundle.source}: ${QualityPromotionEligibility.reviewReason(evaluation.eligibility) ?? "allowWarn or force required"} (use allowWarn or force)`,
      )
    }
    return finalizePromotion({
      bundle: decisionBundle.benchmark,
      currentActive: evaluation.currentActive,
      eligibility: evaluation.eligibility,
      stability: evaluation.stability,
      force: options?.force,
      promotionMetadata: options?.promotionMetadata,
      decisionBundleCreatedAt: decisionBundle.createdAt,
      approvalPacket,
      approval: approvals[0],
      approvals,
      adoptionReviews: resolvedAdoptionReviews,
      adoptionReviewConsensus,
      adoptionDissentResolutions: resolvedDissentResolutions,
      adoptionDissentResolution,
      adoptionDissentSupersessions: resolvedDissentSupersessions,
      adoptionDissentSupersession,
      adoptionDissentHandlingBundle,
      adoptionDissentHandling,
      approvalEvaluation,
      releasePolicy: decisionBundle.releasePolicy,
      approvalPolicySuggestion:
        decisionBundle.approvalPolicySuggestion ??
        QualityPromotionDecisionBundle.deriveApprovalPolicySuggestion(decisionBundle),
    })
  }

  export async function promoteSubmissionBundle(
    submissionBundle: QualityPromotionSubmissionBundle.BundleArtifact,
    options?: {
      allowWarn?: boolean
      force?: boolean
      promotionMetadata?: PromotionMetadata
      releasePolicyResolution?: QualityPromotionReleasePolicyStore.Resolution
    },
  ) {
    const submissionReasons = QualityPromotionSubmissionBundle.verify(submissionBundle.decisionBundle, submissionBundle)
    if (submissionReasons.length > 0) {
      throw new Error(
        `Cannot promote model ${submissionBundle.source}: invalid submission bundle (${submissionReasons[0]})`,
      )
    }
    await QualityPromotionSubmissionBundle.assertPersisted(submissionBundle)
    if (submissionBundle.summary.overallStatus !== "pass") {
      throw new Error(
        `Cannot promote model ${submissionBundle.source}: submission bundle not ready (${submissionBundle.summary.gates.find((gate) => gate.status === "fail")?.detail ?? "unknown failure"})`,
      )
    }
    const result = await promoteApprovedDecisionBundle(submissionBundle.decisionBundle, undefined, {
      allowWarn: options?.allowWarn,
      force: options?.force,
      promotionMetadata: options?.promotionMetadata,
      approvalPacket: submissionBundle.approvalPacket,
      releasePolicyResolution: options?.releasePolicyResolution,
    })
    const record = PromotionRecord.parse({
      ...result.record,
      submissionBundle: {
        submissionID: submissionBundle.submissionID,
        createdAt: submissionBundle.createdAt,
        decisionBundleCreatedAt: submissionBundle.decisionBundle.createdAt,
        approvalPacketID: submissionBundle.approvalPacket.packetID,
        overallStatus: submissionBundle.summary.overallStatus,
        eligibilityDecision: submissionBundle.summary.eligibilityDecision,
        requiredOverride: submissionBundle.summary.requiredOverride,
      },
    })
    await Storage.write(promotionKey(result.record.promotionID), record)
    return {
      ...result,
      record,
    }
  }

  export async function promoteReviewDossier(
    reviewDossier: QualityPromotionReviewDossier.DossierArtifact,
    options?: {
      allowWarn?: boolean
      force?: boolean
      promotionMetadata?: PromotionMetadata
      releasePolicyResolution?: QualityPromotionReleasePolicyStore.Resolution
    },
  ) {
    const dossierReasons = QualityPromotionReviewDossier.verify(
      reviewDossier.submissionBundle.decisionBundle,
      reviewDossier,
    )
    if (dossierReasons.length > 0) {
      throw new Error(`Cannot promote model ${reviewDossier.source}: invalid review dossier (${dossierReasons[0]})`)
    }
    await QualityPromotionReviewDossier.assertPersisted(reviewDossier)
    if (reviewDossier.summary.overallStatus !== "pass") {
      throw new Error(
        `Cannot promote model ${reviewDossier.source}: review dossier not ready (${reviewDossier.summary.gates.find((gate) => gate.status === "fail")?.detail ?? "unknown failure"})`,
      )
    }
    const result = await promoteSubmissionBundle(reviewDossier.submissionBundle, {
      allowWarn: options?.allowWarn,
      force: options?.force,
      promotionMetadata: options?.promotionMetadata,
      releasePolicyResolution: options?.releasePolicyResolution,
    })
    const record = PromotionRecord.parse({
      ...result.record,
      reviewDossier: {
        dossierID: reviewDossier.dossierID,
        createdAt: reviewDossier.createdAt,
        submissionID: reviewDossier.submissionBundle.submissionID,
        submissionCreatedAt: reviewDossier.submissionBundle.createdAt,
        decisionBundleCreatedAt: reviewDossier.submissionBundle.decisionBundle.createdAt,
        approvalPacketID: reviewDossier.submissionBundle.approvalPacket.packetID,
        overallStatus: reviewDossier.summary.overallStatus,
        recommendation: reviewDossier.summary.recommendation,
      },
    })
    await Storage.write(promotionKey(result.record.promotionID), record)
    return {
      ...result,
      record,
    }
  }

  export async function promoteBoardDecision(
    boardDecision: QualityPromotionBoardDecision.DecisionArtifact,
    options?: {
      promotionMetadata?: PromotionMetadata
      releasePolicyResolution?: QualityPromotionReleasePolicyStore.Resolution
    },
  ) {
    const boardDecisionReasons = QualityPromotionBoardDecision.verify(
      boardDecision.reviewDossier.submissionBundle.decisionBundle,
      boardDecision,
    )
    if (boardDecisionReasons.length > 0) {
      throw new Error(
        `Cannot promote model ${boardDecision.source}: invalid board decision (${boardDecisionReasons[0]})`,
      )
    }
    await QualityPromotionBoardDecision.assertPersisted(boardDecision)
    if (boardDecision.summary.overallStatus !== "pass") {
      throw new Error(
        `Cannot promote model ${boardDecision.source}: board decision not ready (${boardDecision.summary.gates.find((gate) => gate.status === "fail")?.detail ?? "unknown failure"})`,
      )
    }
    const result = await promoteReviewDossier(boardDecision.reviewDossier, {
      allowWarn: boardDecision.summary.requiredOverride === "allow_warn" && boardDecision.overrideAccepted,
      force: boardDecision.summary.requiredOverride === "force" && boardDecision.overrideAccepted,
      promotionMetadata: options?.promotionMetadata,
      releasePolicyResolution: options?.releasePolicyResolution,
    })
    const record = PromotionRecord.parse({
      ...result.record,
      boardDecision: {
        decisionID: boardDecision.decisionID,
        decidedAt: boardDecision.decidedAt,
        decider: boardDecision.decider,
        role: boardDecision.role,
        team: boardDecision.team ?? null,
        reportingChain: boardDecision.reportingChain ?? null,
        disposition: boardDecision.disposition,
        overrideAccepted: boardDecision.overrideAccepted,
        dossierID: boardDecision.reviewDossier.dossierID,
        recommendation: boardDecision.summary.recommendation,
        requiredOverride: boardDecision.summary.requiredOverride,
        overallStatus: boardDecision.summary.overallStatus,
      },
    })
    await Storage.write(promotionKey(result.record.promotionID), record)
    return {
      ...result,
      record,
    }
  }

  export async function promoteReleaseDecisionRecord(
    releaseDecisionRecord: QualityPromotionReleaseDecisionRecord.RecordArtifact,
    options?: {
      promotionMetadata?: PromotionMetadata
      releasePolicyResolution?: QualityPromotionReleasePolicyStore.Resolution
    },
  ) {
    const recordReasons = QualityPromotionReleaseDecisionRecord.verify(
      releaseDecisionRecord.boardDecision.reviewDossier.submissionBundle.decisionBundle,
      releaseDecisionRecord,
    )
    if (recordReasons.length > 0) {
      throw new Error(
        `Cannot promote model ${releaseDecisionRecord.source}: invalid release decision record (${recordReasons[0]})`,
      )
    }
    await QualityPromotionReleaseDecisionRecord.assertPersisted(releaseDecisionRecord)
    if (releaseDecisionRecord.summary.overallStatus !== "pass") {
      throw new Error(
        `Cannot promote model ${releaseDecisionRecord.source}: release decision record not ready (${releaseDecisionRecord.summary.gates.find((gate) => gate.status === "fail")?.detail ?? "unknown failure"})`,
      )
    }
    const result = await promoteBoardDecision(releaseDecisionRecord.boardDecision, {
      releasePolicyResolution: options?.releasePolicyResolution,
      promotionMetadata: options?.promotionMetadata,
    })
    const record = PromotionRecord.parse({
      ...result.record,
      releaseDecisionRecord: {
        recordID: releaseDecisionRecord.recordID,
        recordedAt: releaseDecisionRecord.recordedAt,
        decisionID: releaseDecisionRecord.boardDecision.decisionID,
        disposition: releaseDecisionRecord.summary.disposition,
        overrideAccepted: releaseDecisionRecord.summary.overrideAccepted,
        authorizedPromotion: releaseDecisionRecord.summary.authorizedPromotion,
        promotionMode: releaseDecisionRecord.summary.promotionMode,
        overallStatus: releaseDecisionRecord.summary.overallStatus,
      },
    })
    await Storage.write(promotionKey(result.record.promotionID), record)
    return {
      ...result,
      record,
    }
  }

  async function preflightReleasePacketArtifacts(input: {
    releasePacket: QualityPromotionReleasePacket.PacketArtifact
    promotionMetadata: PromotionMetadata
    archiveSigning: QualityPromotionSignedArchive.SigningInput
    attestationPolicyResolution: QualityPromotionSignedArchiveAttestationPolicyStore.Resolution
  }) {
    const decision = input.releasePacket.summary.promotionMode
    const currentActive = await getActive()
    const baseSnapshot = buildReleasePacketPromotionSnapshot({
      releasePacket: input.releasePacket,
      promotionMetadata: input.promotionMetadata,
      previousActiveSource: currentActive?.source ?? null,
      decision,
    })
    const auditManifest = QualityPromotionAuditManifest.create({
      releasePacket: input.releasePacket,
      promotion: baseSnapshot,
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
    const signedArchive = QualityPromotionSignedArchive.create({
      packagedArchive,
      signing: input.archiveSigning,
    })
    const signedArchiveTrust = await QualityPromotionSignedArchiveTrust.evaluate({
      archive: signedArchive,
      keyMaterial: input.archiveSigning.keyMaterial,
      projectID: input.attestationPolicyResolution.projectID ?? undefined,
    })
    const signedArchiveAttestation = QualityPromotionSignedArchiveAttestationPolicy.evaluate({
      trust: signedArchiveTrust,
      policy: input.attestationPolicyResolution.policy,
      policySource: input.attestationPolicyResolution.source,
      policyProjectID: input.attestationPolicyResolution.projectID,
    })
    if (!signedArchiveAttestation.acceptedByPolicy) {
      throw new Error(
        `Cannot promote model ${input.releasePacket.source}: signed archive attestation policy not satisfied (${signedArchiveAttestation.gates.find((gate) => gate.status === "fail")?.detail ?? "unknown failure"})`,
      )
    }
    return {
      promotion: baseSnapshot,
      previousActiveSource: currentActive?.source ?? null,
      decision,
      auditManifest,
      exportBundle,
      archiveManifest,
      handoffPackage,
      portableExport,
      packagedArchive,
      signedArchive,
      signedArchiveTrust,
      signedArchiveAttestation,
    }
  }

  export async function promoteReleasePacket(
    releasePacket: QualityPromotionReleasePacket.PacketArtifact,
    options?: {
      releasePolicyResolution?: QualityPromotionReleasePolicyStore.Resolution
      archiveSigning?: QualityPromotionSignedArchive.SigningInput
      attestationPolicyResolution?: QualityPromotionSignedArchiveAttestationPolicyStore.Resolution
    },
  ) {
    const packetReasons = QualityPromotionReleasePacket.verify(
      releasePacket.releaseDecisionRecord.boardDecision.reviewDossier.submissionBundle.decisionBundle,
      releasePacket,
    )
    if (packetReasons.length > 0) {
      throw new Error(`Cannot promote model ${releasePacket.source}: invalid release packet (${packetReasons[0]})`)
    }
    await QualityPromotionReleasePacket.assertPersisted(releasePacket)
    if (releasePacket.summary.overallStatus !== "pass") {
      throw new Error(
        `Cannot promote model ${releasePacket.source}: release packet not ready (${releasePacket.summary.gates.find((gate) => gate.status === "fail")?.detail ?? "unknown failure"})`,
      )
    }
    const attestationProjectID = releasePacketAttestationProjectID(releasePacket)
    if (
      options?.archiveSigning &&
      options.attestationPolicyResolution?.projectID &&
      attestationProjectID &&
      options.attestationPolicyResolution.projectID !== attestationProjectID
    ) {
      throw new Error(
        `Cannot promote model ${releasePacket.source}: attestation policy resolution project mismatch (${options.attestationPolicyResolution.projectID} vs ${attestationProjectID})`,
      )
    }
    const attestationPolicyResolution = options?.archiveSigning
      ? (options.attestationPolicyResolution ??
        (await QualityPromotionSignedArchiveAttestationPolicyStore.resolve({
          projectID: attestationProjectID ?? undefined,
        })))
      : undefined
    const promotionMetadata = options?.archiveSigning ? createPromotionMetadata(releasePacket.source) : undefined
    const preflight = options?.archiveSigning
      ? await preflightReleasePacketArtifacts({
          releasePacket,
          promotionMetadata: promotionMetadata!,
          archiveSigning: options.archiveSigning,
          attestationPolicyResolution: attestationPolicyResolution!,
        })
      : undefined
    const result = await promoteReleaseDecisionRecord(releasePacket.releaseDecisionRecord, {
      releasePolicyResolution: options?.releasePolicyResolution,
      promotionMetadata,
    })
    const record = PromotionRecord.parse({
      ...result.record,
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
    await Storage.write(promotionKey(result.record.promotionID), record)
    const auditManifest =
      preflight?.auditManifest ??
      QualityPromotionAuditManifest.create({
        releasePacket,
        promotion: auditManifestPromotionSnapshot(record),
      })
    await QualityPromotionAuditManifest.append(auditManifest)
    const exportBundle =
      preflight?.exportBundle ??
      QualityPromotionExportBundle.create({
        auditManifest,
      })
    await QualityPromotionExportBundle.append(exportBundle)
    const archiveManifest =
      preflight?.archiveManifest ??
      QualityPromotionArchiveManifest.create({
        exportBundle,
      })
    await QualityPromotionArchiveManifest.append(archiveManifest)
    const handoffPackage =
      preflight?.handoffPackage ??
      QualityPromotionHandoffPackage.create({
        archiveManifest,
      })
    await QualityPromotionHandoffPackage.append(handoffPackage)
    const portableExport =
      preflight?.portableExport ??
      QualityPromotionPortableExport.create({
        handoffPackage,
      })
    await QualityPromotionPortableExport.append(portableExport)
    const packagedArchive =
      preflight?.packagedArchive ??
      QualityPromotionPackagedArchive.create({
        portableExport,
      })
    await QualityPromotionPackagedArchive.append(packagedArchive)
    const signedArchive =
      preflight?.signedArchive ??
      (options?.archiveSigning
        ? QualityPromotionSignedArchive.create({
            packagedArchive,
            signing: options.archiveSigning,
          })
        : undefined)
    if (signedArchive) {
      await QualityPromotionSignedArchive.append(signedArchive)
    }
    const signedArchiveAttestationRecord =
      signedArchive && preflight
        ? QualityPromotionSignedArchiveAttestationRecord.create({
            signedArchive,
            trust: preflight.signedArchiveTrust,
            attestation: preflight.signedArchiveAttestation,
          })
        : undefined
    if (signedArchiveAttestationRecord) {
      await QualityPromotionSignedArchiveAttestationRecord.append(signedArchiveAttestationRecord)
    }
    const signedArchiveAttestationPacket = signedArchiveAttestationRecord
      ? QualityPromotionSignedArchiveAttestationPacket.create({
          promotion: {
            promotionID: record.promotionID,
            source: record.source,
            promotedAt: record.promotedAt,
            decision: record.decision,
            previousActiveSource: record.previousActiveSource,
            releasePacketID: releasePacket.packetID,
            promotionMode: releasePacket.summary.promotionMode,
            authorizedPromotion: releasePacket.summary.authorizedPromotion,
            signedArchiveID: signedArchiveAttestationRecord.signedArchive.signedArchiveID,
          },
          attestationRecord: signedArchiveAttestationRecord,
        })
      : undefined
    if (signedArchiveAttestationPacket) {
      await QualityPromotionSignedArchiveAttestationPacket.append(signedArchiveAttestationPacket)
    }
    const signedArchiveGovernancePacket = signedArchiveAttestationPacket
      ? QualityPromotionSignedArchiveGovernancePacket.create({
          promotion: signedArchiveAttestationPacket.promotion,
          releasePacket,
          attestationPacket: signedArchiveAttestationPacket,
        })
      : undefined
    if (signedArchiveGovernancePacket) {
      await QualityPromotionSignedArchiveGovernancePacket.append(signedArchiveGovernancePacket)
    }
    const signedArchiveReviewDossier = signedArchiveGovernancePacket
      ? QualityPromotionSignedArchiveReviewDossier.create({
          governancePacket: signedArchiveGovernancePacket,
          handoffPackage,
        })
      : undefined
    if (signedArchiveReviewDossier) {
      await QualityPromotionSignedArchiveReviewDossier.append(signedArchiveReviewDossier)
    }
    const recordWithArtifacts = PromotionRecord.parse({
      ...record,
      auditManifest: {
        manifestID: auditManifest.manifestID,
        createdAt: auditManifest.createdAt,
        packetID: auditManifest.releasePacket.packetID,
        promotionID: auditManifest.promotion.promotionID,
        decision: auditManifest.summary.promotionDecision,
        promotionMode: auditManifest.summary.promotionMode,
        overallStatus: auditManifest.summary.overallStatus,
      },
      exportBundle: {
        bundleID: exportBundle.bundleID,
        createdAt: exportBundle.createdAt,
        manifestID: exportBundle.auditManifest.manifestID,
        packetID: exportBundle.auditManifest.releasePacket.packetID,
        promotionID: exportBundle.auditManifest.promotion.promotionID,
        decision: exportBundle.summary.promotionDecision,
        promotionMode: exportBundle.summary.promotionMode,
        overallStatus: exportBundle.summary.overallStatus,
      },
      archiveManifest: {
        archiveID: archiveManifest.archiveID,
        createdAt: archiveManifest.createdAt,
        bundleID: archiveManifest.exportBundle.bundleID,
        manifestID: archiveManifest.exportBundle.auditManifest.manifestID,
        packetID: archiveManifest.exportBundle.auditManifest.releasePacket.packetID,
        promotionID: archiveManifest.exportBundle.auditManifest.promotion.promotionID,
        inventoryCount: archiveManifest.summary.inventoryCount,
        promotionMode: archiveManifest.summary.promotionMode,
        overallStatus: archiveManifest.summary.overallStatus,
      },
      handoffPackage: {
        packageID: handoffPackage.packageID,
        createdAt: handoffPackage.createdAt,
        archiveID: handoffPackage.archiveManifest.archiveID,
        bundleID: handoffPackage.archiveManifest.exportBundle.bundleID,
        manifestID: handoffPackage.archiveManifest.exportBundle.auditManifest.manifestID,
        packetID: handoffPackage.archiveManifest.exportBundle.auditManifest.releasePacket.packetID,
        promotionID: handoffPackage.archiveManifest.exportBundle.auditManifest.promotion.promotionID,
        documentCount: handoffPackage.summary.documentCount,
        overallStatus: handoffPackage.summary.overallStatus,
      },
      portableExport: {
        exportID: portableExport.exportID,
        createdAt: portableExport.createdAt,
        packageID: portableExport.handoffPackage.packageID,
        archiveID: portableExport.handoffPackage.archiveManifest.archiveID,
        bundleID: portableExport.handoffPackage.archiveManifest.exportBundle.bundleID,
        promotionID: portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion.promotionID,
        fileCount: portableExport.summary.fileCount,
        overallStatus: portableExport.summary.overallStatus,
      },
      packagedArchive: {
        archiveID: packagedArchive.archiveID,
        createdAt: packagedArchive.createdAt,
        exportID: packagedArchive.portableExport.exportID,
        packageID: packagedArchive.portableExport.handoffPackage.packageID,
        promotionID:
          packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion
            .promotionID,
        entryCount: packagedArchive.summary.entryCount,
        overallStatus: packagedArchive.summary.overallStatus,
      },
      signedArchive: signedArchive
        ? {
            signedArchiveID: signedArchive.signedArchiveID,
            createdAt: signedArchive.createdAt,
            archiveID: signedArchive.packagedArchive.archiveID,
            exportID: signedArchive.packagedArchive.portableExport.exportID,
            promotionID:
              signedArchive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest
                .promotion.promotionID,
            keyID: signedArchive.attestation.keyID,
            attestedBy: signedArchive.attestation.attestedBy,
            algorithm: signedArchive.attestation.algorithm,
            overallStatus: signedArchive.summary.overallStatus,
          }
        : undefined,
      signedArchiveTrust: preflight
        ? {
            overallStatus: preflight.signedArchiveTrust.overallStatus,
            trusted: preflight.signedArchiveTrust.trusted,
            signatureStatus: preflight.signedArchiveTrust.signatureStatus,
            registryStatus: preflight.signedArchiveTrust.registryStatus,
            lifecycleStatus: preflight.signedArchiveTrust.lifecycleStatus,
            resolution: preflight.signedArchiveTrust.resolution,
          }
        : undefined,
      signedArchiveAttestation: preflight
        ? {
            overallStatus: preflight.signedArchiveAttestation.overallStatus,
            policySource: preflight.signedArchiveAttestation.policySource,
            policyProjectID: preflight.signedArchiveAttestation.policyProjectID,
            policyDigest: preflight.signedArchiveAttestation.policyDigest,
            acceptedByPolicy: preflight.signedArchiveAttestation.acceptedByPolicy,
            trustStatus: preflight.signedArchiveAttestation.trustStatus,
            minimumScopeStatus: preflight.signedArchiveAttestation.minimumScopeStatus,
            lifecyclePolicyStatus: preflight.signedArchiveAttestation.lifecyclePolicyStatus,
            effectiveTrustScope: preflight.signedArchiveAttestation.effectiveTrustScope,
            effectiveTrustLifecycle: preflight.signedArchiveAttestation.effectiveTrustLifecycle,
          }
        : undefined,
      signedArchiveAttestationRecord: signedArchiveAttestationRecord
        ? {
            recordID: signedArchiveAttestationRecord.recordID,
            createdAt: signedArchiveAttestationRecord.createdAt,
            signedArchiveID: signedArchiveAttestationRecord.signedArchive.signedArchiveID,
            promotionID: signedArchiveAttestationRecord.promotionID,
            trustStatus: signedArchiveAttestationRecord.summary.trustStatus,
            attestationStatus: signedArchiveAttestationRecord.summary.attestationStatus,
            trusted: signedArchiveAttestationRecord.summary.trusted,
            acceptedByPolicy: signedArchiveAttestationRecord.summary.acceptedByPolicy,
            policySource: signedArchiveAttestationRecord.summary.policySource,
            policyProjectID: signedArchiveAttestationRecord.summary.policyProjectID,
            overallStatus: signedArchiveAttestationRecord.summary.overallStatus,
          }
        : undefined,
      signedArchiveAttestationPacket: signedArchiveAttestationPacket
        ? {
            packetID: signedArchiveAttestationPacket.packetID,
            createdAt: signedArchiveAttestationPacket.createdAt,
            promotionID: signedArchiveAttestationPacket.promotion.promotionID,
            signedArchiveID: signedArchiveAttestationPacket.summary.signedArchiveID,
            trustStatus: signedArchiveAttestationPacket.summary.trustStatus,
            attestationStatus: signedArchiveAttestationPacket.summary.attestationStatus,
            acceptedByPolicy: signedArchiveAttestationPacket.summary.acceptedByPolicy,
            policySource: signedArchiveAttestationPacket.summary.policySource,
            policyProjectID: signedArchiveAttestationPacket.summary.policyProjectID,
            overallStatus: signedArchiveAttestationPacket.summary.overallStatus,
          }
        : undefined,
      signedArchiveGovernancePacket: signedArchiveGovernancePacket
        ? {
            packetID: signedArchiveGovernancePacket.packetID,
            createdAt: signedArchiveGovernancePacket.createdAt,
            promotionID: signedArchiveGovernancePacket.promotion.promotionID,
            releasePacketID: signedArchiveGovernancePacket.summary.releasePacketID,
            signedArchiveID: signedArchiveGovernancePacket.summary.signedArchiveID,
            authorizedPromotion: signedArchiveGovernancePacket.summary.authorizedPromotion,
            promotionMode: signedArchiveGovernancePacket.summary.promotionMode,
            policySource: signedArchiveGovernancePacket.summary.policySource,
            policyProjectID: signedArchiveGovernancePacket.summary.policyProjectID,
            overallStatus: signedArchiveGovernancePacket.summary.overallStatus,
          }
        : undefined,
      signedArchiveReviewDossier: signedArchiveReviewDossier
        ? {
            dossierID: signedArchiveReviewDossier.dossierID,
            createdAt: signedArchiveReviewDossier.createdAt,
            promotionID: signedArchiveReviewDossier.governancePacket.promotion.promotionID,
            governancePacketID: signedArchiveReviewDossier.governancePacket.packetID,
            packageID: signedArchiveReviewDossier.handoffPackage.packageID,
            releasePacketID: signedArchiveReviewDossier.summary.releasePacketID,
            signedArchiveID: signedArchiveReviewDossier.summary.signedArchiveID,
            authorizedPromotion: signedArchiveReviewDossier.summary.authorizedPromotion,
            promotionMode: signedArchiveReviewDossier.summary.promotionMode,
            policySource: signedArchiveReviewDossier.summary.policySource,
            policyProjectID: signedArchiveReviewDossier.summary.policyProjectID,
            overallStatus: signedArchiveReviewDossier.summary.overallStatus,
          }
        : undefined,
    })
    await Storage.write(promotionKey(result.record.promotionID), recordWithArtifacts)
    return {
      ...result,
      record: recordWithArtifacts,
    }
  }

  export async function rollbackPromotion(
    promotion: PromotionRecord,
    watch: QualityPromotionWatch.WatchSummary,
    options?: { allowWarn?: boolean; force?: boolean },
  ) {
    if (promotion.source !== watch.source) {
      throw new Error(`Rollback watch source mismatch: promotion=${promotion.source} watch=${watch.source}`)
    }
    if (promotion.promotedAt !== watch.promotedAt) {
      throw new Error(`Rollback watch timestamp mismatch for model ${promotion.source}`)
    }

    const status = watch.overallStatus
    if (status === "pass" && !options?.force) {
      throw new Error(`Cannot rollback model ${promotion.source}: watch status is pass`)
    }
    if (status === "warn" && !options?.allowWarn && !options?.force) {
      throw new Error(`Cannot rollback model ${promotion.source}: watch status is warn (use allowWarn or force)`)
    }

    const currentActive = await getActive()
    if (currentActive?.source !== promotion.source && !options?.force) {
      throw new Error(
        `Cannot rollback model ${promotion.source}: current active model is ${currentActive?.source ?? "none"}`,
      )
    }

    const resultingActive = promotion.previousActiveSource ? await activate(promotion.previousActiveSource) : undefined
    if (!promotion.previousActiveSource) {
      await clearActive()
    }

    const decision = options?.force ? "force" : status === "warn" ? "warn_override" : "fail_guard"
    const rolledBackAt = new Date().toISOString()
    const rollbackID = `${Date.now()}-${encode(promotion.source)}`
    const priorRollbacks = await listRollbacks(promotion.source)
    const stability = QualityStabilityGuard.summarize({
      source: promotion.source,
      rollbacks: [...priorRollbacks, { source: promotion.source, rolledBackAt }],
    })
    const record = RollbackRecord.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-model-rollback",
      rollbackID,
      source: promotion.source,
      rolledBackAt,
      promotionID: promotion.promotionID,
      promotedAt: promotion.promotedAt,
      previousActiveSource: promotion.previousActiveSource,
      rollbackTargetSource: promotion.previousActiveSource,
      resultingActiveSource: resultingActive?.source ?? null,
      decision,
      reentryContextID: rollbackID,
      watch: {
        overallStatus: status,
        totalRecords: watch.window.totalRecords,
        sessionsCovered: watch.window.sessionsCovered,
        releasePolicy: watch.releasePolicy
          ? {
              policySource: watch.releasePolicy.provenance.policySource,
              policyProjectID: watch.releasePolicy.provenance.policyProjectID,
              compatibilityApprovalSource: watch.releasePolicy.provenance.compatibilityApprovalSource,
              resolvedAt: watch.releasePolicy.provenance.resolvedAt,
              persistedScope: watch.releasePolicy.provenance.persistedScope,
              persistedUpdatedAt: watch.releasePolicy.provenance.persistedUpdatedAt,
              digest: watch.releasePolicy.provenance.digest,
            }
          : undefined,
        gates: watch.gates,
      },
      stability,
    })
    await Storage.write(rollbackKey(rollbackID), record)
    await QualityReentryContext.append(
      QualityReentryContext.create({
        rollback: record,
        watch,
      }),
    )
    return { active: resultingActive ?? null, record, stability }
  }
}
