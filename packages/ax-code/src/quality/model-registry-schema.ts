import z from "zod"
import { QualityCalibrationModel } from "./calibration-model"
import { QualityPromotionAdoptionDissentHandling } from "./promotion-adoption-dissent-handling"
import { QualityPromotionAdoptionDissentSupersession } from "./promotion-adoption-dissent-supersession"
import { QualityPromotionAdoptionReview } from "./promotion-adoption-review"
import { QualityPromotionApprovalPolicy } from "./promotion-approval-policy"
import { QualityPromotionBoardDecision } from "./promotion-board-decision"
import { QualityPromotionDecisionBundle } from "./promotion-decision-bundle"
import { QualityPromotionEligibility } from "./promotion-eligibility"
import { QualityPromotionReleaseDecisionRecord } from "./promotion-release-decision-record"
import { QualityPromotionReleasePolicy } from "./promotion-release-policy"
import { QualityPromotionReviewDossier } from "./promotion-review-dossier"
import { QualityStabilityGuard } from "./stability-guard"

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
      approvalConcentrationPreset: z.lazy(() => QualityPromotionApprovalPolicy.ApprovalConcentrationPreset).nullable(),
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
