import { QualityCalibrationModel } from "../calibration-model"
import { QualityPromotionAdoptionDissentHandling } from "../promotion-adoption-dissent-handling"
import { QualityPromotionAdoptionDissentResolution } from "../promotion-adoption-dissent-resolution"
import { QualityPromotionAdoptionDissentSupersession } from "../promotion-adoption-dissent-supersession"
import { QualityPromotionAdoptionReview } from "../promotion-adoption-review"
import { QualityPromotionApproval } from "../promotion-approval"
import { QualityPromotionApprovalPacket } from "../promotion-approval-packet"
import { QualityPromotionApprovalPolicy } from "../promotion-approval-policy"
import { QualityPromotionDecisionBundle } from "../promotion-decision-bundle"
import { QualityPromotionEligibility } from "../promotion-eligibility"
import { QualityPromotionReleasePolicyStore } from "../promotion-release-policy-store"
import { QualityPromotionSubmissionBundle } from "../promotion-submission-bundle"
import { QualityStabilityGuard } from "../stability-guard"
import { QualityStorageKey } from "../storage-key"
import {
  approvalPacketRecordSummary,
  approvalPolicyRecordSummary,
  approvalRecordSummary,
  adoptionDissentHandlingBundleRecordSummary,
  adoptionDissentResolutionRecordSummary,
  adoptionDissentResolutionSummaryRecord,
  adoptionDissentSupersessionRecordSummary,
  adoptionDissentSupersessionSummaryRecord,
  adoptionReviewRecordSummary,
  releasePolicyRecordSummary,
  submissionBundleRecordSummary,
} from "../model-registry-record-summary"
import { QualityModelRegistry } from "./index"

type PromotionMetadata = QualityModelRegistry.PromotionMetadata
type ActiveRecord = QualityModelRegistry.ActiveRecord

function encode(input: string) {
  return QualityStorageKey.encode(input)
}

export function finalizePromotion(input: {
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
    const registered = await QualityModelRegistry.register(input.bundle.model)
    const previousActive = input.currentActive
    const active = await QualityModelRegistry.activate(input.bundle.model.source)
    const decision = input.force
      ? "force"
      : input.eligibility.requiredOverride === "allow_warn"
        ? "warn_override"
        : "pass"
    const promotedAt = input.promotionMetadata?.promotedAt ?? new Date().toISOString()
    const promotionID = input.promotionMetadata?.promotionID ?? `${Date.now()}-${encode(input.bundle.model.source)}`
    const record = QualityModelRegistry.PromotionRecord.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-model-promotion",
      promotionID,
      source: input.bundle.model.source,
      promotedAt,
      previousActiveSource: previousActive?.source ?? null,
      decision,
      decisionBundleCreatedAt: input.decisionBundleCreatedAt ?? null,
      submissionBundle: input.submissionBundle ? submissionBundleRecordSummary(input.submissionBundle) : undefined,
      approval: input.approval ? approvalRecordSummary(input.approval) : undefined,
      approvalPacket: input.approvalPacket ? approvalPacketRecordSummary(input.approvalPacket) : undefined,
      approvals: input.approvals?.map(approvalRecordSummary),
      adoptionReviews: input.adoptionReviews?.map(adoptionReviewRecordSummary),
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
      adoptionDissentResolutions: input.adoptionDissentResolutions?.map(adoptionDissentResolutionRecordSummary),
      adoptionDissentResolution: input.adoptionDissentResolution
        ? adoptionDissentResolutionSummaryRecord(input.adoptionDissentResolution)
        : undefined,
      adoptionDissentSupersessions: input.adoptionDissentSupersessions?.map(adoptionDissentSupersessionRecordSummary),
      adoptionDissentSupersession: input.adoptionDissentSupersession
        ? adoptionDissentSupersessionSummaryRecord(input.adoptionDissentSupersession)
        : undefined,
      adoptionDissentHandlingBundle: input.adoptionDissentHandlingBundle
        ? adoptionDissentHandlingBundleRecordSummary(input.adoptionDissentHandlingBundle)
        : undefined,
      adoptionDissentHandling: input.adoptionDissentHandling ?? undefined,
      approvalPolicy: input.approvalEvaluation ? approvalPolicyRecordSummary(input.approvalEvaluation) : undefined,
      releasePolicy: input.releasePolicy ? releasePolicyRecordSummary(input.releasePolicy) : undefined,
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
    await QualityModelRegistry.writePromotionRecord(record)
    return { registered, active, record, stability: input.stability, eligibility: input.eligibility }
  })()
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
  const { currentActive, stability, eligibility } = await QualityModelRegistry.evaluatePromotionEligibility(bundle, {
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
  const evaluation = await QualityModelRegistry.evaluatePromotionEligibility(decisionBundle.benchmark, {
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
