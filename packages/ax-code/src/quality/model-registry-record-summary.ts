import type { QualityPromotionAdoptionReview } from "./promotion-adoption-review"
import type { QualityPromotionAdoptionDissentHandling } from "./promotion-adoption-dissent-handling"
import type { QualityPromotionAdoptionDissentResolution } from "./promotion-adoption-dissent-resolution"
import type { QualityPromotionAdoptionDissentSupersession } from "./promotion-adoption-dissent-supersession"
import type { QualityPromotionApproval } from "./promotion-approval"
import type { QualityPromotionApprovalPacket } from "./promotion-approval-packet"
import type { QualityPromotionApprovalPolicy } from "./promotion-approval-policy"
import type { QualityPromotionBoardDecision } from "./promotion-board-decision"
import type { QualityPromotionDecisionBundle } from "./promotion-decision-bundle"
import type { QualityModelRegistry } from "./model-registry"
import type { QualityPromotionReleaseDecisionRecord } from "./promotion-release-decision-record"
import type { QualityPromotionReleasePacket } from "./promotion-release-packet"
import type { QualityPromotionReviewDossier } from "./promotion-review-dossier"
import type { QualityPromotionSubmissionBundle } from "./promotion-submission-bundle"

type PromotionRecord = QualityModelRegistry.PromotionRecord

export function submissionBundleRecordSummary(
  submissionBundle: QualityPromotionSubmissionBundle.BundleArtifact,
): NonNullable<PromotionRecord["submissionBundle"]> {
  return {
    submissionID: submissionBundle.submissionID,
    createdAt: submissionBundle.createdAt,
    decisionBundleCreatedAt: submissionBundle.decisionBundle.createdAt,
    approvalPacketID: submissionBundle.approvalPacket.packetID,
    overallStatus: submissionBundle.summary.overallStatus,
    eligibilityDecision: submissionBundle.summary.eligibilityDecision,
    requiredOverride: submissionBundle.summary.requiredOverride,
  }
}

export function reviewDossierRecordSummary(
  reviewDossier: QualityPromotionReviewDossier.DossierArtifact,
): NonNullable<PromotionRecord["reviewDossier"]> {
  const submissionBundle = reviewDossier.submissionBundle
  return {
    dossierID: reviewDossier.dossierID,
    createdAt: reviewDossier.createdAt,
    submissionID: submissionBundle.submissionID,
    submissionCreatedAt: submissionBundle.createdAt,
    decisionBundleCreatedAt: submissionBundle.decisionBundle.createdAt,
    approvalPacketID: submissionBundle.approvalPacket.packetID,
    overallStatus: reviewDossier.summary.overallStatus,
    recommendation: reviewDossier.summary.recommendation,
  }
}

export function boardDecisionRecordSummary(
  boardDecision: QualityPromotionBoardDecision.DecisionArtifact,
): NonNullable<PromotionRecord["boardDecision"]> {
  return {
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
  }
}

export function releaseDecisionRecordSummary(
  releaseDecisionRecord: QualityPromotionReleaseDecisionRecord.RecordArtifact,
): NonNullable<PromotionRecord["releaseDecisionRecord"]> {
  return {
    recordID: releaseDecisionRecord.recordID,
    recordedAt: releaseDecisionRecord.recordedAt,
    decisionID: releaseDecisionRecord.boardDecision.decisionID,
    disposition: releaseDecisionRecord.summary.disposition,
    overrideAccepted: releaseDecisionRecord.summary.overrideAccepted,
    authorizedPromotion: releaseDecisionRecord.summary.authorizedPromotion,
    promotionMode: releaseDecisionRecord.summary.promotionMode,
    overallStatus: releaseDecisionRecord.summary.overallStatus,
  }
}

export function releasePacketRecordSummary(
  releasePacket: QualityPromotionReleasePacket.PacketArtifact,
): NonNullable<PromotionRecord["releasePacket"]> {
  return {
    packetID: releasePacket.packetID,
    createdAt: releasePacket.createdAt,
    recordID: releasePacket.releaseDecisionRecord.recordID,
    decisionID: releasePacket.releaseDecisionRecord.boardDecision.decisionID,
    authorizedPromotion: releasePacket.summary.authorizedPromotion,
    promotionMode: releasePacket.summary.promotionMode,
    overallStatus: releasePacket.summary.overallStatus,
  }
}

export function approvalRecordSummary(
  approval: QualityPromotionApproval.ApprovalArtifact,
): NonNullable<PromotionRecord["approval"]> {
  return {
    approvalID: approval.approvalID,
    approvedAt: approval.approvedAt,
    approver: approval.approver,
    role: approval.role,
    team: approval.team ?? null,
    reportingChain: approval.reportingChain ?? null,
    disposition: approval.disposition,
    decisionBundleCreatedAt: approval.decisionBundle.createdAt,
    decisionBundleDigest: approval.decisionBundle.digest,
  }
}

export function adoptionReviewRecordSummary(
  review: QualityPromotionAdoptionReview.ReviewArtifact,
): NonNullable<PromotionRecord["adoptionReviews"]>[number] {
  return {
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
  }
}

export function adoptionDissentResolutionRecordSummary(
  resolution: QualityPromotionAdoptionDissentResolution.ResolutionArtifact,
): NonNullable<PromotionRecord["adoptionDissentResolutions"]>[number] {
  return {
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
  }
}

export function adoptionDissentResolutionSummaryRecord(
  resolution: QualityPromotionAdoptionDissentResolution.ResolutionSummary,
): NonNullable<PromotionRecord["adoptionDissentResolution"]> {
  return {
    overallStatus: resolution.overallStatus,
    adoptionStatus: resolution.adoptionStatus,
    requiredRole: resolution.requiredRole,
    totalResolutions: resolution.totalResolutions,
    qualifyingResolutions: resolution.qualifyingResolutions,
    distinctQualifyingResolvers: resolution.distinctQualifyingResolvers,
    totalQualifiedRejectingReviews: resolution.totalQualifiedRejectingReviews,
    coveredQualifiedRejectingReviews: resolution.coveredQualifiedRejectingReviews,
    unresolvedQualifiedRejectingReviews: resolution.unresolvedQualifiedRejectingReviews,
    distinctQualifiedRejectingReviewers: resolution.distinctQualifiedRejectingReviewers,
  }
}

export function adoptionDissentSupersessionRecordSummary(
  supersession: QualityPromotionAdoptionDissentSupersession.SupersessionArtifact,
): NonNullable<PromotionRecord["adoptionDissentSupersessions"]>[number] {
  return {
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
  }
}

export function adoptionDissentSupersessionSummaryRecord(
  supersession: QualityPromotionAdoptionDissentSupersession.SupersessionSummary,
): NonNullable<PromotionRecord["adoptionDissentSupersession"]> {
  return {
    overallStatus: supersession.overallStatus,
    adoptionStatus: supersession.adoptionStatus,
    requiredRole: supersession.requiredRole,
    totalSupersessions: supersession.totalSupersessions,
    qualifyingSupersessions: supersession.qualifyingSupersessions,
    distinctQualifyingSuperseders: supersession.distinctQualifyingSuperseders,
    totalQualifiedRejectingReviews: supersession.totalQualifiedRejectingReviews,
    coveredQualifiedRejectingReviews: supersession.coveredQualifiedRejectingReviews,
    unresolvedQualifiedRejectingReviews: supersession.unresolvedQualifiedRejectingReviews,
    coveredByReviewerRereview: supersession.coveredByReviewerRereview,
    coveredByEvidenceSupersession: supersession.coveredByEvidenceSupersession,
  }
}

export function adoptionDissentHandlingBundleRecordSummary(
  handling: QualityPromotionAdoptionDissentHandling.HandlingArtifact,
): NonNullable<PromotionRecord["adoptionDissentHandlingBundle"]> {
  return {
    handlingID: handling.handlingID,
    handledAt: handling.handledAt,
    decisionBundleCreatedAt: handling.decisionBundle.createdAt,
    decisionBundleDigest: handling.decisionBundle.digest,
    suggestionDigest: handling.suggestion.digest,
    adoptionStatus: handling.suggestion.adoptionStatus,
    qualifiedRejectingReviewCount: handling.qualifiedRejectingReviews.length,
    resolutionCount: handling.resolutions.length,
    supersessionCount: handling.supersessions.length,
  }
}

export function approvalPacketRecordSummary(
  approvalPacket: QualityPromotionApprovalPacket.PacketArtifact,
): NonNullable<PromotionRecord["approvalPacket"]> {
  return {
    packetID: approvalPacket.packetID,
    createdAt: approvalPacket.createdAt,
    decisionBundleCreatedAt: approvalPacket.decisionBundle.createdAt,
    decisionBundleDigest: approvalPacket.decisionBundle.digest,
    adoptionStatus: approvalPacket.suggestion.adoptionStatus,
    approvalCount: approvalPacket.approvals.length,
    adoptionReviewCount: approvalPacket.adoptionReviews.length,
    hasDissentHandling: !!approvalPacket.dissentHandling,
    overallStatus: approvalPacket.readiness.overallStatus,
  }
}

export function approvalPolicyRecordSummary(
  approvalPolicy: QualityPromotionApprovalPolicy.EvaluationSummary,
): NonNullable<PromotionRecord["approvalPolicy"]> {
  return {
    overallStatus: approvalPolicy.overallStatus,
    policySource: approvalPolicy.policySource,
    policyProjectID: approvalPolicy.policyProjectID,
    requiredOverride: approvalPolicy.requiredOverride,
    requiredApprovals: approvalPolicy.requirement.minimumApprovals,
    minimumRole: approvalPolicy.requirement.minimumRole,
    distinctApproversRequired: approvalPolicy.requirement.requireDistinctApprovers,
    independentReviewRequired: approvalPolicy.independentReviewRequired,
    priorApproverExclusionRequired: approvalPolicy.priorApproverExclusionRequired,
    maxPriorApproverOverlapRatio: approvalPolicy.maxPriorApproverOverlapRatio,
    reviewerCarryoverBudget: approvalPolicy.reviewerCarryoverBudget,
    reviewerCarryoverLookbackPromotions: approvalPolicy.reviewerCarryoverLookbackPromotions,
    teamCarryoverBudget: approvalPolicy.teamCarryoverBudget,
    teamCarryoverLookbackPromotions: approvalPolicy.teamCarryoverLookbackPromotions,
    maxPriorReportingChainOverlapRatio: approvalPolicy.maxPriorReportingChainOverlapRatio,
    reportingChainCarryoverBudget: approvalPolicy.reportingChainCarryoverBudget,
    reportingChainCarryoverLookbackPromotions: approvalPolicy.reportingChainCarryoverLookbackPromotions,
    roleCohortDiversityRequired: approvalPolicy.roleCohortDiversityRequired,
    minimumDistinctRoleCohorts: approvalPolicy.minimumDistinctRoleCohorts,
    reviewerTeamDiversityRequired: approvalPolicy.reviewerTeamDiversityRequired,
    minimumDistinctReviewerTeams: approvalPolicy.minimumDistinctReviewerTeams,
    reportingChainDiversityRequired: approvalPolicy.reportingChainDiversityRequired,
    minimumDistinctReportingChains: approvalPolicy.minimumDistinctReportingChains,
    qualifiedApprovals: approvalPolicy.qualifiedApprovals,
    independentQualifiedApprovals: approvalPolicy.independentQualifiedApprovals,
    freshQualifiedApprovals: approvalPolicy.freshQualifiedApprovals,
    overlappingQualifiedApprovers: approvalPolicy.overlappingQualifiedApprovers,
    priorApproverOverlapRatio: approvalPolicy.priorApproverOverlapRatio,
    reviewerCarryoverScore: approvalPolicy.reviewerCarryoverScore,
    carriedOverQualifiedApprovers: approvalPolicy.carriedOverQualifiedApprovers,
    teamCarryoverScore: approvalPolicy.teamCarryoverScore,
    carriedOverQualifiedTeams: approvalPolicy.carriedOverQualifiedTeams,
    overlappingQualifiedReportingChains: approvalPolicy.overlappingQualifiedReportingChains,
    priorReportingChainOverlapRatio: approvalPolicy.priorReportingChainOverlapRatio,
    reportingChainCarryoverScore: approvalPolicy.reportingChainCarryoverScore,
    carriedOverQualifiedReportingChains: approvalPolicy.carriedOverQualifiedReportingChains,
    distinctQualifiedRoleCohorts: approvalPolicy.distinctQualifiedRoleCohorts,
    distinctQualifiedReviewerTeams: approvalPolicy.distinctQualifiedReviewerTeams,
    missingQualifiedReviewerTeams: approvalPolicy.missingQualifiedReviewerTeams,
    distinctQualifiedReportingChains: approvalPolicy.distinctQualifiedReportingChains,
    missingQualifiedReportingChains: approvalPolicy.missingQualifiedReportingChains,
    approverReuseRatio: approvalPolicy.approverReuseRatio,
    teamReuseRatio: approvalPolicy.teamReuseRatio,
    reportingChainReuseRatio: approvalPolicy.reportingChainReuseRatio,
    approvalConcentrationBudget: approvalPolicy.approvalConcentrationBudget,
    approvalConcentrationPreset: approvalPolicy.approvalConcentrationPreset,
    approvalConcentrationWeights: approvalPolicy.approvalConcentrationWeights,
    approvalConcentrationScore: approvalPolicy.approvalConcentrationScore,
    approvalConcentrationApplicableAxes: approvalPolicy.approvalConcentrationApplicableAxes,
    approvalConcentrationAppliedWeightTotal: approvalPolicy.approvalConcentrationAppliedWeightTotal,
    distinctQualifiedApprovers: approvalPolicy.distinctQualifiedApprovers,
    priorPromotionApprovers: approvalPolicy.priorPromotionApprovers.length,
    priorPromotionReportingChains: approvalPolicy.priorPromotionReportingChains.length,
  }
}

export function releasePolicyRecordSummary(
  releasePolicy: QualityPromotionDecisionBundle.ReleasePolicySnapshot,
): NonNullable<PromotionRecord["releasePolicy"]> {
  return {
    policySource: releasePolicy.provenance.policySource,
    policyProjectID: releasePolicy.provenance.policyProjectID,
    compatibilityApprovalSource: releasePolicy.provenance.compatibilityApprovalSource,
    resolvedAt: releasePolicy.provenance.resolvedAt,
    persistedScope: releasePolicy.provenance.persistedScope,
    persistedUpdatedAt: releasePolicy.provenance.persistedUpdatedAt,
    digest: releasePolicy.provenance.digest,
    policy: releasePolicy.policy,
  }
}
