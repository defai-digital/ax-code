import { QualityPromotionAdoptionDissentHandling } from "../promotion-adoption-dissent-handling"
import { QualityPromotionAdoptionDissentResolution } from "../promotion-adoption-dissent-resolution"
import { QualityPromotionAdoptionDissentSupersession } from "../promotion-adoption-dissent-supersession"
import { QualityPromotionAdoptionReview } from "../promotion-adoption-review"
import { QualityPromotionApproval } from "../promotion-approval"
import { QualityPromotionApprovalPacket } from "../promotion-approval-packet"
import { QualityPromotionApprovalPolicy } from "../promotion-approval-policy"
import { QualityPromotionApprovalPolicyStore } from "../promotion-approval-policy-store"
import { QualityPromotionBoardDecision } from "../promotion-board-decision"
import { QualityPromotionDecisionBundle } from "../promotion-decision-bundle"
import { QualityPromotionEligibility } from "../promotion-eligibility"
import { QualityPromotionReleaseDecisionRecord } from "../promotion-release-decision-record"
import { QualityPromotionReleasePolicyStore } from "../promotion-release-policy-store"
import { QualityPromotionReviewDossier } from "../promotion-review-dossier"
import { QualityPromotionSubmissionBundle } from "../promotion-submission-bundle"
import {
  boardDecisionRecordSummary,
  releaseDecisionRecordSummary,
  reviewDossierRecordSummary,
  submissionBundleRecordSummary,
} from "../model-registry-record-summary"
import { QualityModelRegistry } from "./index"
import { finalizePromotion } from "./promote"
import { assertPromotionSummaryPass } from "./promotion-summary"

type PromotionMetadata = QualityModelRegistry.PromotionMetadata

function optionalInputArray<T>(input: T | T[] | null | undefined) {
  if (input == null) return []
  return Array.isArray(input) ? input : [input]
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
  const approvalPackets = optionalInputArray(options?.approvalPacket)
  if (approvalPackets.length > 1) {
    throw new Error(`Cannot promote model ${decisionBundle.source}: provide at most one approval packet`)
  }
  const directApprovals = optionalInputArray(approvalInput)
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
    assertPromotionSummaryPass(
      decisionBundle.source,
      "approval packet readiness not satisfied",
      approvalPacket.readiness,
    )
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
    const adoptionReviews = optionalInputArray(options?.adoptionReviews)
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
    const dissentHandlingBundles = optionalInputArray(options?.dissentHandling)
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
      const dissentResolutions = optionalInputArray(options?.dissentResolutions)
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

      const dissentSupersessions = optionalInputArray(options?.dissentSupersessions)
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
  assertPromotionSummaryPass(decisionBundle.source, "approval policy not satisfied", approvalEvaluation)

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
  assertPromotionSummaryPass(submissionBundle.source, "submission bundle not ready", submissionBundle.summary)
  const result = await promoteApprovedDecisionBundle(submissionBundle.decisionBundle, undefined, {
    allowWarn: options?.allowWarn,
    force: options?.force,
    promotionMetadata: options?.promotionMetadata,
    approvalPacket: submissionBundle.approvalPacket,
    releasePolicyResolution: options?.releasePolicyResolution,
  })
  const record = QualityModelRegistry.PromotionRecord.parse({
    ...result.record,
    submissionBundle: submissionBundleRecordSummary(submissionBundle),
  })
  await QualityModelRegistry.writePromotionRecord(record)
  return { ...result, record }
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
  assertPromotionSummaryPass(reviewDossier.source, "review dossier not ready", reviewDossier.summary)
  const result = await promoteSubmissionBundle(reviewDossier.submissionBundle, {
    allowWarn: options?.allowWarn,
    force: options?.force,
    promotionMetadata: options?.promotionMetadata,
    releasePolicyResolution: options?.releasePolicyResolution,
  })
  const record = QualityModelRegistry.PromotionRecord.parse({
    ...result.record,
    reviewDossier: reviewDossierRecordSummary(reviewDossier),
  })
  await QualityModelRegistry.writePromotionRecord(record)
  return { ...result, record }
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
  assertPromotionSummaryPass(boardDecision.source, "board decision not ready", boardDecision.summary)
  const result = await promoteReviewDossier(boardDecision.reviewDossier, {
    allowWarn: boardDecision.summary.requiredOverride === "allow_warn" && boardDecision.overrideAccepted,
    force: boardDecision.summary.requiredOverride === "force" && boardDecision.overrideAccepted,
    promotionMetadata: options?.promotionMetadata,
    releasePolicyResolution: options?.releasePolicyResolution,
  })
  const record = QualityModelRegistry.PromotionRecord.parse({
    ...result.record,
    boardDecision: boardDecisionRecordSummary(boardDecision),
  })
  await QualityModelRegistry.writePromotionRecord(record)
  return { ...result, record }
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
  assertPromotionSummaryPass(
    releaseDecisionRecord.source,
    "release decision record not ready",
    releaseDecisionRecord.summary,
  )
  const result = await promoteBoardDecision(releaseDecisionRecord.boardDecision, {
    releasePolicyResolution: options?.releasePolicyResolution,
    promotionMetadata: options?.promotionMetadata,
  })
  const record = QualityModelRegistry.PromotionRecord.parse({
    ...result.record,
    releaseDecisionRecord: releaseDecisionRecordSummary(releaseDecisionRecord),
  })
  await QualityModelRegistry.writePromotionRecord(record)
  return { ...result, record }
}
