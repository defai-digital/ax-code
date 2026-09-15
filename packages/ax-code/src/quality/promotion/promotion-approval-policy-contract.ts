import z from "zod"

export const PolicySource = z.enum(["explicit", "project", "global", "default"])
export type PolicySource = z.output<typeof PolicySource>

export const ApprovalRole = z.enum([
  "engineer",
  "senior-engineer",
  "staff-engineer",
  "principal-engineer",
  "manager",
  "director",
  "vp",
])
export type ApprovalRole = z.output<typeof ApprovalRole>

export const APPROVAL_ROLE_RANK: Record<ApprovalRole, number> = {
  engineer: 1,
  "senior-engineer": 2,
  "staff-engineer": 3,
  "principal-engineer": 4,
  manager: 5,
  director: 6,
  vp: 7,
}

export function normalizeApprovalRole(role: string | null | undefined): ApprovalRole | null {
  if (!role) return null
  const parsed = ApprovalRole.safeParse(role.trim().toLowerCase())
  return parsed.success ? parsed.data : null
}

export function normalizeApprovalTeam(team: string | null | undefined) {
  const normalized = team?.trim().toLowerCase()
  return normalized ? normalized : null
}

export function normalizeApprovalReportingChain(reportingChain: string | null | undefined) {
  const normalized = reportingChain?.trim().toLowerCase()
  return normalized ? normalized : null
}

export const ApprovalRoleCohort = z.enum(["individual-contributor", "management"])
export type ApprovalRoleCohort = z.output<typeof ApprovalRoleCohort>

export const ApprovalConcentrationWeights = z
  .object({
    approver: z.number().min(0),
    team: z.number().min(0),
    reportingChain: z.number().min(0),
  })
  .refine(
    (weights) => weights.approver > 0 || weights.team > 0 || weights.reportingChain > 0,
    "At least one approval concentration axis weight must be positive",
  )
export type ApprovalConcentrationWeights = z.output<typeof ApprovalConcentrationWeights>

export const DEFAULT_APPROVAL_CONCENTRATION_WEIGHTS = ApprovalConcentrationWeights.parse({
  approver: 1,
  team: 1,
  reportingChain: 1,
})

export const ApprovalConcentrationPreset = z.enum(["balanced", "reviewer-heavy", "org-heavy"])
export type ApprovalConcentrationPreset = z.output<typeof ApprovalConcentrationPreset>

export const ApprovalConcentrationRiskTier = z.enum(["standard", "elevated", "critical"])
export type ApprovalConcentrationRiskTier = z.output<typeof ApprovalConcentrationRiskTier>

export const ApprovalConcentrationWorkflow = z.enum(["review", "debug", "refactor", "qa"])
export type ApprovalConcentrationWorkflow = z.output<typeof ApprovalConcentrationWorkflow>

export function concentrationWeightsForPreset(preset: ApprovalConcentrationPreset) {
  switch (preset) {
    case "balanced":
      return ApprovalConcentrationWeights.parse({
        approver: 1 / 3,
        team: 1 / 3,
        reportingChain: 1 / 3,
      })
    case "reviewer-heavy":
      return ApprovalConcentrationWeights.parse({
        approver: 0.5,
        team: 0.25,
        reportingChain: 0.25,
      })
    case "org-heavy":
      return ApprovalConcentrationWeights.parse({
        approver: 0.2,
        team: 0.4,
        reportingChain: 0.4,
      })
  }
}

export const DEFAULT_REENTRY_APPROVAL_CONCENTRATION_WEIGHTS = ApprovalConcentrationWeights.parse({
  approver: 0.5,
  team: 0.25,
  reportingChain: 0.25,
})

export const ConcentrationRecommendation = z.object({
  workflow: ApprovalConcentrationWorkflow.nullable(),
  riskTier: ApprovalConcentrationRiskTier,
  preset: ApprovalConcentrationPreset,
  budget: z.number().min(0).max(1),
  weights: ApprovalConcentrationWeights,
  escalated: z.boolean(),
  rationale: z.array(z.string()).min(1),
})
export type ConcentrationRecommendation = z.output<typeof ConcentrationRecommendation>

export const ConcentrationWorkflowSource = z.enum(["explicit", "benchmark", "mixed", "unknown"])
export type ConcentrationWorkflowSource = z.output<typeof ConcentrationWorkflowSource>

export const ConcentrationRiskTierSource = z.enum(["explicit", "eligibility"])
export type ConcentrationRiskTierSource = z.output<typeof ConcentrationRiskTierSource>

export const ContextualConcentrationRecommendation = z.object({
  workflow: ApprovalConcentrationWorkflow.nullable(),
  workflowSource: ConcentrationWorkflowSource,
  riskTier: ApprovalConcentrationRiskTier,
  riskTierSource: ConcentrationRiskTierSource,
  samePolicyRetry: z.boolean(),
  forcePath: z.boolean(),
  priorRollbacks: z.number().int().nonnegative(),
  recommendation: ConcentrationRecommendation,
})
export type ContextualConcentrationRecommendation = z.output<typeof ContextualConcentrationRecommendation>

const CONCENTRATION_WEIGHT_EPSILON = 1e-9

type RecommendationContextLike = {
  benchmark: {
    model: {
      groups: Array<{
        workflow?: string | null
      }>
    }
  }
  eligibility: {
    requiredOverride: "none" | "allow_warn" | "force"
    decision: "go" | "review" | "no_go"
    benchmarkStatus?: "pass" | "warn" | "fail"
    stabilityStatus?: "pass" | "warn" | "fail"
    reentryContext?: {
      sameReleasePolicyAsCurrent?: boolean | null
    } | null
    history?: {
      priorRollbacks?: number
    }
  }
  snapshot?: {
    priorRollbacks?: number
  }
}

function matchesConcentrationPreset(preset: ApprovalConcentrationPreset, weights: ApprovalConcentrationWeights) {
  const expected = concentrationWeightsForPreset(preset)
  return (
    Math.abs(weights.approver - expected.approver) <= CONCENTRATION_WEIGHT_EPSILON &&
    Math.abs(weights.team - expected.team) <= CONCENTRATION_WEIGHT_EPSILON &&
    Math.abs(weights.reportingChain - expected.reportingChain) <= CONCENTRATION_WEIGHT_EPSILON
  )
}

function recommendationForPreset(
  preset: ApprovalConcentrationPreset,
  workflow: ApprovalConcentrationWorkflow | null,
  riskTier: ApprovalConcentrationRiskTier,
  escalated: boolean,
  rationale: string[],
): ConcentrationRecommendation {
  const budget = preset === "balanced" ? 0.5 : preset === "reviewer-heavy" ? 0.4 : 0.3
  return ConcentrationRecommendation.parse({
    workflow,
    riskTier,
    preset,
    budget,
    weights: concentrationWeightsForPreset(preset),
    escalated,
    rationale,
  })
}

function inferWorkflowFromContext(input: RecommendationContextLike): {
  workflow: ApprovalConcentrationWorkflow | null
  workflowSource: ConcentrationWorkflowSource
} {
  const workflows = [
    ...new Set(
      input.benchmark.model.groups
        .map((group) => group.workflow)
        .filter(
          (workflow): workflow is string =>
            workflow === "review" || workflow === "debug" || workflow === "refactor" || workflow === "qa",
        ),
    ),
  ].sort()
  if (workflows.length === 1) {
    return {
      workflow: workflows[0] as ApprovalConcentrationWorkflow,
      workflowSource: "benchmark",
    }
  }
  if (workflows.length > 1) {
    return {
      workflow: null,
      workflowSource: "mixed",
    }
  }
  return {
    workflow: null,
    workflowSource: "unknown",
  }
}

function inferRiskTierFromContext(input: RecommendationContextLike): {
  riskTier: ApprovalConcentrationRiskTier
  riskTierSource: ConcentrationRiskTierSource
} {
  if (
    input.eligibility.requiredOverride === "force" ||
    input.eligibility.decision === "no_go" ||
    input.eligibility.benchmarkStatus === "fail" ||
    input.eligibility.stabilityStatus === "fail"
  ) {
    return {
      riskTier: "critical",
      riskTierSource: "eligibility",
    }
  }
  if (
    input.eligibility.requiredOverride === "allow_warn" ||
    input.eligibility.decision === "review" ||
    input.eligibility.benchmarkStatus === "warn" ||
    input.eligibility.stabilityStatus === "warn"
  ) {
    return {
      riskTier: "elevated",
      riskTierSource: "eligibility",
    }
  }
  return {
    riskTier: "standard",
    riskTierSource: "eligibility",
  }
}

function basePresetForRiskTier(input: {
  workflow?: ApprovalConcentrationWorkflow | null
  riskTier: ApprovalConcentrationRiskTier
}): ApprovalConcentrationPreset {
  if (!input.workflow) {
    return input.riskTier === "standard" ? "balanced" : input.riskTier === "elevated" ? "reviewer-heavy" : "org-heavy"
  }

  switch (input.workflow) {
    case "review":
      return input.riskTier === "standard" ? "balanced" : input.riskTier === "elevated" ? "reviewer-heavy" : "org-heavy"
    case "debug":
      return input.riskTier === "critical" ? "org-heavy" : "reviewer-heavy"
    case "refactor":
      return input.riskTier === "standard" ? "reviewer-heavy" : "org-heavy"
    case "qa":
      return input.riskTier === "standard" ? "balanced" : input.riskTier === "elevated" ? "reviewer-heavy" : "org-heavy"
  }
}

function escalatePreset(preset: ApprovalConcentrationPreset, steps: number): ApprovalConcentrationPreset {
  if (steps <= 0) return preset
  const order: ApprovalConcentrationPreset[] = ["balanced", "reviewer-heavy", "org-heavy"]
  const index = order.indexOf(preset)
  return order[Math.min(order.length - 1, index + steps)]
}

export function recommendConcentration(input: {
  workflow?: ApprovalConcentrationWorkflow | null
  riskTier: ApprovalConcentrationRiskTier
  samePolicyRetry?: boolean
  forcePath?: boolean
  priorRollbacks?: number
}) {
  const rationale = [`base risk tier=${input.riskTier}`]
  if (input.workflow) rationale.push(`workflow=${input.workflow}`)
  let preset = basePresetForRiskTier({
    workflow: input.workflow ?? null,
    riskTier: input.riskTier,
  })
  let escalated = false
  let escalationSteps = 0
  rationale.push(`workflow baseline preset=${preset}`)
  if (input.samePolicyRetry) {
    escalationSteps += 1
    rationale.push("same-policy retry increases reviewer concentration risk")
  }
  if (input.forcePath) {
    escalationSteps += 1
    rationale.push("force-path approval should bias toward stronger organizational independence")
  }
  if ((input.priorRollbacks ?? 0) >= 2) {
    escalationSteps += 1
    rationale.push(`prior rollbacks=${input.priorRollbacks ?? 0} triggers stricter concentration guidance`)
  }

  if (escalationSteps > 0) {
    escalated = true
    preset = escalatePreset(preset, escalationSteps)
    rationale.push(`escalation steps=${escalationSteps}`)
  }
  rationale.push(`recommended preset=${preset}`)
  return recommendationForPreset(preset, input.workflow ?? null, input.riskTier, escalated, rationale)
}

export function recommendedReentryOverride(input: {
  workflow?: ApprovalConcentrationWorkflow | null
  riskTier: ApprovalConcentrationRiskTier
  samePolicyRetry?: boolean
  forcePath?: boolean
  priorRollbacks?: number
}): ApprovalRequirementOverrides {
  const recommendation = recommendConcentration(input)
  return {
    approvalConcentrationPreset: recommendation.preset,
    approvalConcentrationBudget: recommendation.budget,
    approvalConcentrationWeights: recommendation.weights,
  }
}

export function recommendConcentrationFromContext(input: {
  bundle: RecommendationContextLike
  workflow?: ApprovalConcentrationWorkflow | null
  riskTier?: ApprovalConcentrationRiskTier
  samePolicyRetry?: boolean
  forcePath?: boolean
  priorRollbacks?: number
}): ContextualConcentrationRecommendation {
  const inferredWorkflow = inferWorkflowFromContext(input.bundle)
  const inferredRiskTier = inferRiskTierFromContext(input.bundle)
  const workflow = input.workflow ?? inferredWorkflow.workflow
  const workflowSource: ConcentrationWorkflowSource = input.workflow ? "explicit" : inferredWorkflow.workflowSource
  const riskTier = input.riskTier ?? inferredRiskTier.riskTier
  const riskTierSource: ConcentrationRiskTierSource = input.riskTier ? "explicit" : inferredRiskTier.riskTierSource
  const samePolicyRetry =
    input.samePolicyRetry ?? input.bundle.eligibility.reentryContext?.sameReleasePolicyAsCurrent === true
  const forcePath = input.forcePath ?? input.bundle.eligibility.requiredOverride === "force"
  const priorRollbacks =
    input.priorRollbacks ??
    input.bundle.snapshot?.priorRollbacks ??
    input.bundle.eligibility.history?.priorRollbacks ??
    0
  const recommendation = recommendConcentration({
    workflow,
    riskTier,
    samePolicyRetry,
    forcePath,
    priorRollbacks,
  })

  return ContextualConcentrationRecommendation.parse({
    workflow,
    workflowSource,
    riskTier,
    riskTierSource,
    samePolicyRetry,
    forcePath,
    priorRollbacks,
    recommendation,
  })
}

export function renderConcentrationRecommendation(recommendation: ConcentrationRecommendation) {
  const lines: string[] = []
  lines.push("## ax-code quality approval concentration recommendation")
  lines.push("")
  lines.push(`- workflow: ${recommendation.workflow ?? "general"}`)
  lines.push(`- risk tier: ${recommendation.riskTier}`)
  lines.push(`- preset: ${recommendation.preset}`)
  lines.push(`- budget: ${recommendation.budget}`)
  lines.push(`- escalated: ${recommendation.escalated}`)
  lines.push(
    `- weights: approver=${recommendation.weights.approver}, team=${recommendation.weights.team}, reporting_chain=${recommendation.weights.reportingChain}`,
  )
  lines.push("")
  lines.push("Rationale:")
  for (const item of recommendation.rationale) {
    lines.push(`- ${item}`)
  }
  lines.push("")
  return lines.join("\n")
}

export function renderContextualConcentrationRecommendation(summary: ContextualConcentrationRecommendation) {
  const lines: string[] = []
  lines.push("## ax-code quality approval concentration contextual recommendation")
  lines.push("")
  lines.push(`- workflow: ${summary.workflow ?? "general"}`)
  lines.push(`- workflow source: ${summary.workflowSource}`)
  lines.push(`- risk tier: ${summary.riskTier}`)
  lines.push(`- risk tier source: ${summary.riskTierSource}`)
  lines.push(`- same policy retry: ${summary.samePolicyRetry}`)
  lines.push(`- force path: ${summary.forcePath}`)
  lines.push(`- prior rollbacks: ${summary.priorRollbacks}`)
  lines.push("")
  lines.push(renderConcentrationRecommendation(summary.recommendation).trimEnd())
  lines.push("")
  return lines.join("\n")
}

export const ApprovalRequirement = z
  .object({
    minimumApprovals: z.number().int().nonnegative(),
    minimumRole: ApprovalRole.nullable(),
    requireDistinctApprovers: z.boolean(),
    requireIndependentReviewer: z.boolean().default(false),
    requirePriorApproverExclusion: z.boolean().default(false),
    maxPriorApproverOverlapRatio: z.number().min(0).max(1).nullable().default(null),
    reviewerCarryoverBudget: z.number().nonnegative().nullable().default(null),
    reviewerCarryoverLookbackPromotions: z.number().int().positive().nullable().default(null),
    teamCarryoverBudget: z.number().nonnegative().nullable().default(null),
    teamCarryoverLookbackPromotions: z.number().int().positive().nullable().default(null),
    maxPriorReportingChainOverlapRatio: z.number().min(0).max(1).nullable().default(null),
    reportingChainCarryoverBudget: z.number().nonnegative().nullable().default(null),
    reportingChainCarryoverLookbackPromotions: z.number().int().positive().nullable().default(null),
    requireRoleCohortDiversity: z.boolean().default(false),
    minimumDistinctRoleCohorts: z.number().int().positive().nullable().default(null),
    requireReviewerTeamDiversity: z.boolean().default(false),
    minimumDistinctReviewerTeams: z.number().int().positive().nullable().default(null),
    requireReportingChainDiversity: z.boolean().default(false),
    minimumDistinctReportingChains: z.number().int().positive().nullable().default(null),
    approvalConcentrationBudget: z.number().min(0).max(1).nullable().default(null),
    approvalConcentrationPreset: ApprovalConcentrationPreset.nullable().default(null),
    approvalConcentrationWeights: ApprovalConcentrationWeights.default(DEFAULT_APPROVAL_CONCENTRATION_WEIGHTS),
  })
  .superRefine((requirement, ctx) => {
    if (
      requirement.approvalConcentrationPreset &&
      !matchesConcentrationPreset(requirement.approvalConcentrationPreset, requirement.approvalConcentrationWeights)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `approval concentration preset ${requirement.approvalConcentrationPreset} does not match configured weights`,
        path: ["approvalConcentrationWeights"],
      })
    }
  })
export type ApprovalRequirement = z.output<typeof ApprovalRequirement>

export type ApprovalRequirementOverrides = Partial<Omit<ApprovalRequirement, "approvalConcentrationWeights">> & {
  approvalConcentrationWeights?: Partial<ApprovalConcentrationWeights>
}

export type PolicyOverrides = {
  none?: ApprovalRequirementOverrides
  allowWarn?: ApprovalRequirementOverrides
  force?: ApprovalRequirementOverrides
  reentry?: ApprovalRequirementOverrides
}

export const Policy = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("ax-code-quality-promotion-approval-policy"),
  rules: z.object({
    none: ApprovalRequirement,
    allow_warn: ApprovalRequirement,
    force: ApprovalRequirement,
    reentry: ApprovalRequirement.default({
      minimumApprovals: 1,
      minimumRole: "staff-engineer",
      requireDistinctApprovers: true,
      requireIndependentReviewer: true,
      requirePriorApproverExclusion: true,
      maxPriorApproverOverlapRatio: 0.5,
      reviewerCarryoverBudget: 0.5,
      reviewerCarryoverLookbackPromotions: 3,
      teamCarryoverBudget: 0.5,
      teamCarryoverLookbackPromotions: 3,
      maxPriorReportingChainOverlapRatio: 0.5,
      reportingChainCarryoverBudget: 0.5,
      reportingChainCarryoverLookbackPromotions: 3,
      requireRoleCohortDiversity: true,
      minimumDistinctRoleCohorts: 2,
      requireReviewerTeamDiversity: true,
      minimumDistinctReviewerTeams: 2,
      requireReportingChainDiversity: true,
      minimumDistinctReportingChains: 2,
      approvalConcentrationBudget: 0.4,
      approvalConcentrationPreset: "reviewer-heavy",
      approvalConcentrationWeights: DEFAULT_REENTRY_APPROVAL_CONCENTRATION_WEIGHTS,
    }),
  }),
})
export type Policy = z.output<typeof Policy>

export const PolicyGate = z.object({
  name: z.string(),
  status: z.enum(["pass", "fail"]),
  detail: z.string(),
})
export type PolicyGate = z.output<typeof PolicyGate>

export const ApprovalSummary = z.object({
  approvalID: z.string(),
  approver: z.string(),
  role: z.string().nullable(),
  team: z.string().nullable(),
  reportingChain: z.string().nullable(),
  approvedAt: z.string(),
})
export type ApprovalSummary = z.output<typeof ApprovalSummary>

export const EvaluationSummary = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("ax-code-quality-promotion-approval-evaluation"),
  source: z.string(),
  decisionBundleCreatedAt: z.string(),
  requiredOverride: z.enum(["none", "allow_warn", "force"]),
  policySource: PolicySource,
  policyProjectID: z.string().nullable(),
  policy: Policy,
  reentryApplicable: z.boolean(),
  reentryContextRollbackID: z.string().nullable(),
  baseRequirement: ApprovalRequirement,
  reentryRequirement: ApprovalRequirement.nullable(),
  requirement: ApprovalRequirement,
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
  remediationAuthor: z.string().nullable(),
  independentQualifiedApprovals: z.number().int().nonnegative(),
  priorPromotionID: z.string().nullable(),
  priorPromotionApprovers: z.array(z.string()),
  teamCarryoverHistory: z.array(
    z.object({
      team: z.string(),
      weightedReuseScore: z.number().positive(),
      appearances: z.number().int().positive(),
      mostRecentPromotionID: z.string(),
      mostRecentPromotedAt: z.string(),
    }),
  ),
  priorPromotionReportingChains: z.array(z.string()),
  reviewerCarryoverHistory: z.array(
    z.object({
      approver: z.string(),
      weightedReuseScore: z.number().positive(),
      appearances: z.number().int().positive(),
      mostRecentPromotionID: z.string(),
      mostRecentPromotedAt: z.string(),
    }),
  ),
  reportingChainCarryoverHistory: z.array(
    z.object({
      reportingChain: z.string(),
      weightedReuseScore: z.number().positive(),
      appearances: z.number().int().positive(),
      mostRecentPromotionID: z.string(),
      mostRecentPromotedAt: z.string(),
    }),
  ),
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
  qualifiedRoleCohorts: ApprovalRoleCohort.array(),
  distinctQualifiedRoleCohorts: z.number().int().nonnegative(),
  qualifiedReviewerTeams: z.array(z.string()),
  distinctQualifiedReviewerTeams: z.number().int().nonnegative(),
  missingQualifiedReviewerTeams: z.number().int().nonnegative(),
  qualifiedReportingChains: z.array(z.string()),
  distinctQualifiedReportingChains: z.number().int().nonnegative(),
  missingQualifiedReportingChains: z.number().int().nonnegative(),
  approverReuseRatio: z.number().min(0).max(1).nullable(),
  teamReuseRatio: z.number().min(0).max(1).nullable(),
  reportingChainReuseRatio: z.number().min(0).max(1).nullable(),
  approvalConcentrationBudget: z.number().min(0).max(1).nullable(),
  approvalConcentrationPreset: ApprovalConcentrationPreset.nullable(),
  approvalConcentrationWeights: ApprovalConcentrationWeights,
  approvalConcentrationScore: z.number().min(0).max(1).nullable(),
  approvalConcentrationApplicableAxes: z.array(z.enum(["approver", "team", "reporting_chain"])),
  approvalConcentrationAppliedWeightTotal: z.number().positive().nullable(),
  providedApprovals: z.number().int().nonnegative(),
  approvedArtifacts: z.number().int().nonnegative(),
  matchingArtifacts: z.number().int().nonnegative(),
  qualifiedApprovals: z.number().int().nonnegative(),
  distinctQualifiedApprovers: z.number().int().nonnegative(),
  overallStatus: z.enum(["pass", "fail"]),
  acceptedApprovals: ApprovalSummary.array(),
  gates: PolicyGate.array(),
})
export type EvaluationSummary = z.output<typeof EvaluationSummary>
