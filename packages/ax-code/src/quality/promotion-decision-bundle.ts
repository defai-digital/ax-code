import z from "zod"
import { QualityCalibrationModel } from "./calibration-model"
import { QualityPromotionApprovalPolicy } from "./promotion-approval-policy"
import { QualityPromotionEligibility } from "./promotion-eligibility"
import { QualityPromotionReleasePolicy } from "./promotion-release-policy"
import { QualityStabilityGuard } from "./stability-guard"

export namespace QualityPromotionDecisionBundle {
  const APPROVAL_POLICY_SUGGESTION_EPSILON = 1e-9

  export const Policy = z.object({
    cooldownHours: z.number().nonnegative(),
    repeatFailureWindowHours: z.number().positive(),
    repeatFailureThreshold: z.number().int().positive(),
  })
  export type Policy = z.output<typeof Policy>

  export const HistorySnapshot = z.object({
    currentActiveSource: z.string().nullable(),
    lastPromotionAt: z.string().nullable(),
    lastRollbackAt: z.string().nullable(),
    priorPromotions: z.number().int().nonnegative(),
    priorRollbacks: z.number().int().nonnegative(),
  })
  export type HistorySnapshot = z.output<typeof HistorySnapshot>

  export const ReleasePolicySnapshot = z.object({
    policy: z.lazy(() => QualityPromotionReleasePolicy.Policy),
    provenance: z.lazy(() => QualityPromotionReleasePolicy.PolicyProvenance),
  })
  export type ReleasePolicySnapshot = z.output<typeof ReleasePolicySnapshot>

  export const ApprovalConcentrationPolicySnapshot = z.object({
    approvalConcentrationBudget: z.number().min(0).max(1).nullable(),
    approvalConcentrationPreset: QualityPromotionApprovalPolicy.ApprovalConcentrationPreset.nullable(),
    approvalConcentrationWeights: QualityPromotionApprovalPolicy.ApprovalConcentrationWeights,
  })
  export type ApprovalConcentrationPolicySnapshot = z.output<typeof ApprovalConcentrationPolicySnapshot>

  export const ApprovalPolicySuggestionAlignment = z.object({
    budgetMatches: z.boolean(),
    presetMatches: z.boolean(),
    weightsMatch: z.boolean(),
    overall: z.boolean(),
  })
  export type ApprovalPolicySuggestionAlignment = z.output<typeof ApprovalPolicySuggestionAlignment>

  export const ApprovalPolicyAdoptionField = z.enum([
    "approval_concentration_budget",
    "approval_concentration_preset",
    "approval_concentration_weights",
  ])
  export type ApprovalPolicyAdoptionField = z.output<typeof ApprovalPolicyAdoptionField>

  export const ApprovalPolicyAdoptionDifference = z.object({
    field: ApprovalPolicyAdoptionField,
    status: z.enum(["accepted", "different", "missing_effective"]),
    suggested: z.string(),
    effective: z.string().nullable(),
    detail: z.string(),
  })
  export type ApprovalPolicyAdoptionDifference = z.output<typeof ApprovalPolicyAdoptionDifference>

  export const ApprovalPolicyAdoptionSnapshot = z.object({
    status: z.enum(["accepted", "partially_accepted", "diverged", "no_effective_policy"]),
    acceptedFields: z.number().int().nonnegative(),
    differingFields: z.number().int().nonnegative(),
    missingEffectiveFields: z.number().int().nonnegative(),
    rationale: z.array(z.string()).min(1),
    differences: z.array(ApprovalPolicyAdoptionDifference),
  })
  export type ApprovalPolicyAdoptionSnapshot = z.output<typeof ApprovalPolicyAdoptionSnapshot>

  export const ApprovalPolicySuggestionSnapshot = z.object({
    source: z.literal("decision-bundle-contextual"),
    recommendation: z.lazy(() => QualityPromotionApprovalPolicy.ContextualConcentrationRecommendation),
    suggestedReentryPolicy: ApprovalConcentrationPolicySnapshot,
    effectiveReentryPolicy: ApprovalConcentrationPolicySnapshot.nullable(),
    alignment: ApprovalPolicySuggestionAlignment.nullable(),
    adoption: ApprovalPolicyAdoptionSnapshot,
  })
  export type ApprovalPolicySuggestionSnapshot = z.output<typeof ApprovalPolicySuggestionSnapshot>

  type ApprovalPolicySuggestionContext = {
    benchmark: QualityCalibrationModel.BenchmarkBundle
    eligibility: QualityPromotionEligibility.EligibilitySummary
    snapshot: HistorySnapshot
    releasePolicy?: ReleasePolicySnapshot
  }

  export const DecisionBundle = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-decision-bundle"),
    createdAt: z.string(),
    source: z.string(),
    policy: Policy,
    releasePolicy: ReleasePolicySnapshot.optional(),
    approvalPolicySuggestion: ApprovalPolicySuggestionSnapshot.optional(),
    benchmark: z.lazy(() => QualityCalibrationModel.BenchmarkBundle),
    stability: z.lazy(() => QualityStabilityGuard.StabilitySummary),
    eligibility: z.lazy(() => QualityPromotionEligibility.EligibilitySummary),
    snapshot: HistorySnapshot,
  })
  export type DecisionBundle = z.output<typeof DecisionBundle>

  function normalizedPolicy(input?: Partial<Policy>): Policy {
    return {
      cooldownHours: input?.cooldownHours ?? QualityStabilityGuard.DEFAULT_COOLDOWN_HOURS,
      repeatFailureWindowHours: input?.repeatFailureWindowHours ?? QualityStabilityGuard.DEFAULT_REPEAT_FAILURE_WINDOW_HOURS,
      repeatFailureThreshold: input?.repeatFailureThreshold ?? QualityStabilityGuard.DEFAULT_REPEAT_FAILURE_THRESHOLD,
    }
  }

  function normalizedReleasePolicy(input: {
    policy: Policy
    releasePolicySnapshot?: ReleasePolicySnapshot
  }): ReleasePolicySnapshot {
    if (input.releasePolicySnapshot) return ReleasePolicySnapshot.parse(input.releasePolicySnapshot)
    const policy = QualityPromotionReleasePolicy.defaults({
      stability: input.policy,
    })
    return ReleasePolicySnapshot.parse({
      policy,
      provenance: QualityPromotionReleasePolicy.PolicyProvenance.parse({
        policySource: "default",
        policyProjectID: null,
        compatibilityApprovalSource: null,
        resolvedAt: new Date().toISOString(),
        persistedScope: null,
        persistedUpdatedAt: null,
        digest: QualityPromotionReleasePolicy.digest(policy),
      }),
    })
  }

  function weightsMatch(
    left: QualityPromotionApprovalPolicy.ApprovalConcentrationWeights,
    right: QualityPromotionApprovalPolicy.ApprovalConcentrationWeights,
  ) {
    return (
      Math.abs(left.approver - right.approver) <= APPROVAL_POLICY_SUGGESTION_EPSILON &&
      Math.abs(left.team - right.team) <= APPROVAL_POLICY_SUGGESTION_EPSILON &&
      Math.abs(left.reportingChain - right.reportingChain) <= APPROVAL_POLICY_SUGGESTION_EPSILON
    )
  }

  function formatBudget(value: number | null) {
    return value === null ? "none" : value.toFixed(2)
  }

  function formatPreset(value: QualityPromotionApprovalPolicy.ApprovalConcentrationPreset | null) {
    return value ?? "none"
  }

  function formatWeights(weights: QualityPromotionApprovalPolicy.ApprovalConcentrationWeights) {
    return `approver=${weights.approver.toFixed(2)},team=${weights.team.toFixed(2)},reporting_chain=${weights.reportingChain.toFixed(2)}`
  }

  export function deriveApprovalPolicySuggestion(input: ApprovalPolicySuggestionContext): ApprovalPolicySuggestionSnapshot {
    const recommendation = QualityPromotionApprovalPolicy.recommendConcentrationFromContext({
      bundle: {
        benchmark: input.benchmark,
        eligibility: input.eligibility,
        snapshot: input.snapshot,
      },
    })
    const suggestedBudget = recommendation.recommendation.budget
    const suggestedPreset = recommendation.recommendation.preset
    const suggestedWeights = recommendation.recommendation.weights
    const suggestedReentryPolicy = ApprovalConcentrationPolicySnapshot.parse({
      approvalConcentrationBudget: suggestedBudget,
      approvalConcentrationPreset: suggestedPreset,
      approvalConcentrationWeights: suggestedWeights,
    })
    const effectiveRule = input.releasePolicy?.policy.approval.rules.reentry
    const effectiveReentryPolicy = effectiveRule
      ? ApprovalConcentrationPolicySnapshot.parse({
        approvalConcentrationBudget: effectiveRule.approvalConcentrationBudget,
        approvalConcentrationPreset: effectiveRule.approvalConcentrationPreset,
        approvalConcentrationWeights: effectiveRule.approvalConcentrationWeights,
      })
      : null
    const alignment = effectiveReentryPolicy
      ? ApprovalPolicySuggestionAlignment.parse({
        budgetMatches: effectiveReentryPolicy.approvalConcentrationBudget !== null &&
          Math.abs(
            effectiveReentryPolicy.approvalConcentrationBudget - suggestedBudget,
          ) <= APPROVAL_POLICY_SUGGESTION_EPSILON,
        presetMatches: effectiveReentryPolicy.approvalConcentrationPreset !== null &&
          effectiveReentryPolicy.approvalConcentrationPreset === suggestedPreset,
        weightsMatch: weightsMatch(
          effectiveReentryPolicy.approvalConcentrationWeights,
          suggestedWeights,
        ),
        overall: false,
      })
      : null

    const finalizedAlignment = alignment
      ? {
        ...alignment,
        overall: alignment.budgetMatches && alignment.presetMatches && alignment.weightsMatch,
      }
      : null
    const differences: ApprovalPolicyAdoptionDifference[] = effectiveReentryPolicy
      ? [
        ApprovalPolicyAdoptionDifference.parse({
          field: "approval_concentration_budget",
          status: finalizedAlignment?.budgetMatches ? "accepted" : effectiveReentryPolicy.approvalConcentrationBudget === null ? "missing_effective" : "different",
          suggested: formatBudget(suggestedBudget),
          effective: formatBudget(effectiveReentryPolicy.approvalConcentrationBudget),
          detail: finalizedAlignment?.budgetMatches
            ? `effective budget matches suggested budget ${formatBudget(suggestedBudget)}`
            : effectiveReentryPolicy.approvalConcentrationBudget === null
              ? `effective policy does not set a concentration budget; suggested ${formatBudget(suggestedBudget)}`
              : `effective budget ${formatBudget(effectiveReentryPolicy.approvalConcentrationBudget)} differs from suggested ${formatBudget(suggestedBudget)}`,
        }),
        ApprovalPolicyAdoptionDifference.parse({
          field: "approval_concentration_preset",
          status: finalizedAlignment?.presetMatches ? "accepted" : effectiveReentryPolicy.approvalConcentrationPreset === null ? "missing_effective" : "different",
          suggested: formatPreset(suggestedPreset),
          effective: formatPreset(effectiveReentryPolicy.approvalConcentrationPreset),
          detail: finalizedAlignment?.presetMatches
            ? `effective preset matches suggested preset ${formatPreset(suggestedPreset)}`
            : effectiveReentryPolicy.approvalConcentrationPreset === null
              ? `effective policy does not set a concentration preset; suggested ${formatPreset(suggestedPreset)}`
              : `effective preset ${formatPreset(effectiveReentryPolicy.approvalConcentrationPreset)} differs from suggested ${formatPreset(suggestedPreset)}`,
        }),
        ApprovalPolicyAdoptionDifference.parse({
          field: "approval_concentration_weights",
          status: finalizedAlignment?.weightsMatch ? "accepted" : "different",
          suggested: formatWeights(suggestedWeights),
          effective: formatWeights(effectiveReentryPolicy.approvalConcentrationWeights),
          detail: finalizedAlignment?.weightsMatch
            ? `effective weights match suggested weights ${formatWeights(suggestedWeights)}`
            : `effective weights ${formatWeights(effectiveReentryPolicy.approvalConcentrationWeights)} differ from suggested ${formatWeights(suggestedWeights)}`,
        }),
      ]
      : [
        ApprovalPolicyAdoptionDifference.parse({
          field: "approval_concentration_budget",
          status: "missing_effective",
          suggested: formatBudget(suggestedBudget),
          effective: null,
          detail: `no effective release policy is available; suggested budget ${formatBudget(suggestedBudget)}`,
        }),
        ApprovalPolicyAdoptionDifference.parse({
          field: "approval_concentration_preset",
          status: "missing_effective",
          suggested: formatPreset(suggestedPreset),
          effective: null,
          detail: `no effective release policy is available; suggested preset ${formatPreset(suggestedPreset)}`,
        }),
        ApprovalPolicyAdoptionDifference.parse({
          field: "approval_concentration_weights",
          status: "missing_effective",
          suggested: formatWeights(suggestedWeights),
          effective: null,
          detail: `no effective release policy is available; suggested weights ${formatWeights(suggestedWeights)}`,
        }),
      ]
    const acceptedFields = differences.filter((difference) => difference.status === "accepted").length
    const differingFields = differences.filter((difference) => difference.status === "different").length
    const missingEffectiveFields = differences.filter((difference) => difference.status === "missing_effective").length
    const adoptionStatus = !effectiveReentryPolicy
      ? "no_effective_policy"
      : differingFields === 0 && missingEffectiveFields === 0
        ? "accepted"
        : acceptedFields > 0
          ? "partially_accepted"
          : "diverged"
    const adoptionRationale = !effectiveReentryPolicy
      ? ["No effective release policy snapshot was available, so the recommendation could not be adopted yet."]
      : adoptionStatus === "accepted"
        ? ["Effective release policy fully adopts the suggested approval concentration policy."]
        : adoptionStatus === "partially_accepted"
          ? ["Effective release policy partially adopts the suggested approval concentration policy."]
          : ["Effective release policy diverges from the suggested approval concentration policy."]

    return ApprovalPolicySuggestionSnapshot.parse({
      source: "decision-bundle-contextual",
      recommendation,
      suggestedReentryPolicy,
      effectiveReentryPolicy,
      alignment: finalizedAlignment,
      adoption: {
        status: adoptionStatus,
        acceptedFields,
        differingFields,
        missingEffectiveFields,
        rationale: adoptionRationale,
        differences,
      },
    })
  }

  export function build(input: {
    benchmark: QualityCalibrationModel.BenchmarkBundle
    stability: QualityStabilityGuard.StabilitySummary
    eligibility: QualityPromotionEligibility.EligibilitySummary
    policy?: Partial<Policy>
    releasePolicySnapshot?: ReleasePolicySnapshot
  }): DecisionBundle {
    const createdAt = new Date().toISOString()
    const policy = normalizedPolicy(input.policy)
    const releasePolicy = normalizedReleasePolicy({
      policy,
      releasePolicySnapshot: input.releasePolicySnapshot,
    })
    const snapshot = {
      currentActiveSource: input.eligibility.currentActiveSource,
      lastPromotionAt: input.eligibility.lastPromotionAt,
      lastRollbackAt: input.eligibility.lastRollbackAt,
      priorPromotions: input.eligibility.history.priorPromotions,
      priorRollbacks: input.eligibility.history.priorRollbacks,
    }
    return DecisionBundle.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-decision-bundle",
      createdAt,
      source: input.benchmark.model.source,
      policy,
      releasePolicy,
      approvalPolicySuggestion: deriveApprovalPolicySuggestion({
        benchmark: input.benchmark,
        eligibility: input.eligibility,
        snapshot,
        releasePolicy,
      }),
      benchmark: input.benchmark,
      stability: input.stability,
      eligibility: input.eligibility,
      snapshot,
    })
  }

  export function driftReasons(
    bundle: DecisionBundle,
    current: {
      stability: QualityStabilityGuard.StabilitySummary
      eligibility: QualityPromotionEligibility.EligibilitySummary
      releasePolicy?: ReleasePolicySnapshot
    },
  ) {
    const reasons: string[] = []
    if (bundle.source !== current.eligibility.source) {
      reasons.push(`source changed from ${bundle.source} to ${current.eligibility.source}`)
    }
    if (bundle.snapshot.currentActiveSource !== current.eligibility.currentActiveSource) {
      reasons.push(
        `current active source changed from ${bundle.snapshot.currentActiveSource ?? "none"} to ${current.eligibility.currentActiveSource ?? "none"}`,
      )
    }
    if (bundle.snapshot.lastPromotionAt !== current.eligibility.lastPromotionAt) {
      reasons.push(
        `last promotion timestamp changed from ${bundle.snapshot.lastPromotionAt ?? "none"} to ${current.eligibility.lastPromotionAt ?? "none"}`,
      )
    }
    if (bundle.snapshot.lastRollbackAt !== current.eligibility.lastRollbackAt) {
      reasons.push(
        `last rollback timestamp changed from ${bundle.snapshot.lastRollbackAt ?? "none"} to ${current.eligibility.lastRollbackAt ?? "none"}`,
      )
    }
    if (bundle.snapshot.priorPromotions !== current.eligibility.history.priorPromotions) {
      reasons.push(
        `prior promotions changed from ${bundle.snapshot.priorPromotions} to ${current.eligibility.history.priorPromotions}`,
      )
    }
    if (bundle.snapshot.priorRollbacks !== current.eligibility.history.priorRollbacks) {
      reasons.push(
        `prior rollbacks changed from ${bundle.snapshot.priorRollbacks} to ${current.eligibility.history.priorRollbacks}`,
      )
    }
    if (bundle.eligibility.decision !== current.eligibility.decision) {
      reasons.push(`eligibility decision changed from ${bundle.eligibility.decision} to ${current.eligibility.decision}`)
    }
    if (bundle.eligibility.requiredOverride !== current.eligibility.requiredOverride) {
      reasons.push(
        `required override changed from ${bundle.eligibility.requiredOverride} to ${current.eligibility.requiredOverride}`,
      )
    }
    if ((bundle.eligibility.reentryContext?.rollbackID ?? null) !== (current.eligibility.reentryContext?.rollbackID ?? null)) {
      reasons.push(
        `reentry rollback changed from ${bundle.eligibility.reentryContext?.rollbackID ?? "none"} to ${current.eligibility.reentryContext?.rollbackID ?? "none"}`,
      )
    }
    if ((bundle.eligibility.remediation?.remediationID ?? null) !== (current.eligibility.remediation?.remediationID ?? null)) {
      reasons.push(
        `reentry remediation changed from ${bundle.eligibility.remediation?.remediationID ?? "none"} to ${current.eligibility.remediation?.remediationID ?? "none"}`,
      )
    }
    if (bundle.stability.overallStatus !== current.stability.overallStatus) {
      reasons.push(`stability status changed from ${bundle.stability.overallStatus} to ${current.stability.overallStatus}`)
    }
    if (bundle.releasePolicy && current.releasePolicy) {
      if (bundle.releasePolicy.provenance.digest !== current.releasePolicy.provenance.digest) {
        reasons.push(
          `release policy digest changed from ${bundle.releasePolicy.provenance.digest} to ${current.releasePolicy.provenance.digest}`,
        )
      }
      if (bundle.releasePolicy.provenance.policySource !== current.releasePolicy.provenance.policySource) {
        reasons.push(
          `release policy source changed from ${bundle.releasePolicy.provenance.policySource} to ${current.releasePolicy.provenance.policySource}`,
        )
      }
    }
    return reasons
  }

  export function renderReport(bundle: DecisionBundle) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion decision bundle")
    lines.push("")
    lines.push(`- source: ${bundle.source}`)
    lines.push(`- created at: ${bundle.createdAt}`)
    lines.push(`- decision: ${bundle.eligibility.decision}`)
    lines.push(`- required override: ${bundle.eligibility.requiredOverride}`)
    lines.push(`- benchmark status: ${bundle.eligibility.benchmarkStatus}`)
    lines.push(`- stability status: ${bundle.eligibility.stabilityStatus}`)
    lines.push(`- cooldown hours: ${bundle.policy.cooldownHours}`)
    lines.push(`- repeat failure window hours: ${bundle.policy.repeatFailureWindowHours}`)
    lines.push(`- repeat failure threshold: ${bundle.policy.repeatFailureThreshold}`)
    lines.push(`- release policy source: ${bundle.releasePolicy?.provenance.policySource ?? "n/a"}`)
    lines.push(`- release policy digest: ${bundle.releasePolicy?.provenance.digest ?? "n/a"}`)
    lines.push(`- release policy scope: ${bundle.releasePolicy?.provenance.persistedScope ?? "n/a"}`)
    lines.push(`- suggested concentration preset: ${bundle.approvalPolicySuggestion?.suggestedReentryPolicy.approvalConcentrationPreset ?? "n/a"}`)
    lines.push(`- suggested concentration budget: ${bundle.approvalPolicySuggestion?.suggestedReentryPolicy.approvalConcentrationBudget ?? "n/a"}`)
    lines.push(`- suggested workflow: ${bundle.approvalPolicySuggestion?.recommendation.workflow ?? "general"}`)
    lines.push(`- suggested risk tier: ${bundle.approvalPolicySuggestion?.recommendation.riskTier ?? "n/a"}`)
    lines.push(`- effective concentration preset: ${bundle.approvalPolicySuggestion?.effectiveReentryPolicy?.approvalConcentrationPreset ?? "n/a"}`)
    lines.push(`- effective concentration budget: ${bundle.approvalPolicySuggestion?.effectiveReentryPolicy?.approvalConcentrationBudget ?? "n/a"}`)
    lines.push(`- suggestion aligned with effective policy: ${bundle.approvalPolicySuggestion?.alignment?.overall ?? "n/a"}`)
    lines.push(`- suggestion adoption status: ${bundle.approvalPolicySuggestion?.adoption.status ?? "n/a"}`)
    lines.push(`- suggestion adoption accepted fields: ${bundle.approvalPolicySuggestion?.adoption.acceptedFields ?? "n/a"}`)
    lines.push(`- suggestion adoption differing fields: ${bundle.approvalPolicySuggestion?.adoption.differingFields ?? "n/a"}`)
    lines.push(`- current active source: ${bundle.snapshot.currentActiveSource ?? "none"}`)
    lines.push(`- last promotion at: ${bundle.snapshot.lastPromotionAt ?? "n/a"}`)
    lines.push(`- last rollback at: ${bundle.snapshot.lastRollbackAt ?? "n/a"}`)
    lines.push(`- reentry rollback id: ${bundle.eligibility.reentryContext?.rollbackID ?? "n/a"}`)
    lines.push(`- reentry remediation id: ${bundle.eligibility.remediation?.remediationID ?? "n/a"}`)
    lines.push(`- prior promotions: ${bundle.snapshot.priorPromotions}`)
    lines.push(`- prior rollbacks: ${bundle.snapshot.priorRollbacks}`)
    lines.push("")
    lines.push("Eligibility:")
    for (const gate of bundle.eligibility.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    if (bundle.approvalPolicySuggestion) {
      lines.push("")
      lines.push("Approval policy adoption:")
      for (const difference of bundle.approvalPolicySuggestion.adoption.differences) {
        lines.push(`- [${difference.status}] ${difference.field}: ${difference.detail}`)
      }
    }
    lines.push("")
    return lines.join("\n")
  }
}
