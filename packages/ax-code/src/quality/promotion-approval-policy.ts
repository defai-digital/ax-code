import z from "zod"

export namespace QualityPromotionApprovalPolicy {
  type DecisionBundleLike = {
    source: string
    createdAt: string
    eligibility: {
      requiredOverride: "none" | "allow_warn" | "force"
      decision: "go" | "review" | "no_go"
      reentryContext?: {
        rollbackID: string
        promotionID?: string
        priorPromotionApprovers?: string[]
        teamCarryoverHistory?: Array<{
          team: string
          weightedReuseScore: number
          appearances: number
          mostRecentPromotionID: string
          mostRecentPromotedAt: string
        }>
        priorPromotionReportingChains?: string[]
        reviewerCarryoverHistory?: Array<{
          approver: string
          weightedReuseScore: number
          appearances: number
          mostRecentPromotionID: string
          mostRecentPromotedAt: string
        }>
        reportingChainCarryoverHistory?: Array<{
          reportingChain: string
          weightedReuseScore: number
          appearances: number
          mostRecentPromotionID: string
          mostRecentPromotedAt: string
        }>
      } | null
      remediation?: {
        author: string
      } | null
    }
  }

  type ApprovalArtifactLike = {
    approvalID: string
    approver: string
    role: string | null
    team?: string | null
    reportingChain?: string | null
    approvedAt: string
    disposition: "approved" | "rejected"
    source: string
    decisionBundle: {
      source: string
      createdAt: string
      decision: "go" | "review" | "no_go"
      requiredOverride: "none" | "allow_warn" | "force"
    }
  }

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
        return input.riskTier === "standard"
          ? "balanced"
          : input.riskTier === "elevated"
            ? "reviewer-heavy"
            : "org-heavy"
      case "debug":
        return input.riskTier === "critical" ? "org-heavy" : "reviewer-heavy"
      case "refactor":
        return input.riskTier === "standard" ? "reviewer-heavy" : "org-heavy"
      case "qa":
        return input.riskTier === "standard"
          ? "balanced"
          : input.riskTier === "elevated"
            ? "reviewer-heavy"
            : "org-heavy"
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

  const ROLE_RANK: Record<ApprovalRole, number> = {
    engineer: 1,
    "senior-engineer": 2,
    "staff-engineer": 3,
    "principal-engineer": 4,
    manager: 5,
    director: 6,
    vp: 7,
  }

  function normalizeRole(role: string | null | undefined): ApprovalRole | null {
    if (!role) return null
    const normalized = role.trim().toLowerCase()
    switch (normalized) {
      case "engineer":
      case "senior-engineer":
      case "staff-engineer":
      case "principal-engineer":
      case "manager":
      case "director":
      case "vp":
        return normalized
      default:
        return null
    }
  }

  function qualifiesRole(role: string | null | undefined, minimumRole: ApprovalRole | null) {
    if (!minimumRole) return true
    const normalized = normalizeRole(role)
    if (!normalized) return false
    return ROLE_RANK[normalized] >= ROLE_RANK[minimumRole]
  }

  function stricterRole(a: ApprovalRole | null, b: ApprovalRole | null) {
    if (!a) return b
    if (!b) return a
    return ROLE_RANK[a] >= ROLE_RANK[b] ? a : b
  }

  function stricterOverlapRatioCap(a: number | null, b: number | null) {
    if (a === null) return b
    if (b === null) return a
    return Math.min(a, b)
  }

  function stricterMinimumCount(a: number | null, b: number | null) {
    if (a === null) return b
    if (b === null) return a
    return Math.max(a, b)
  }

  function roleCohort(role: string | null | undefined): ApprovalRoleCohort | null {
    const normalized = normalizeRole(role)
    if (!normalized) return null
    switch (normalized) {
      case "engineer":
      case "senior-engineer":
      case "staff-engineer":
      case "principal-engineer":
        return "individual-contributor"
      case "manager":
      case "director":
      case "vp":
        return "management"
    }
  }

  function normalizeTeam(team: string | null | undefined) {
    const normalized = team?.trim().toLowerCase()
    return normalized ? normalized : null
  }

  function normalizeReportingChain(reportingChain: string | null | undefined) {
    const normalized = reportingChain?.trim().toLowerCase()
    return normalized ? normalized : null
  }

  function mergeRequirement(
    baseRequirement: ApprovalRequirement,
    override?: ApprovalRequirementOverrides,
  ): ApprovalRequirement {
    const hasWeightOverride = override?.approvalConcentrationWeights !== undefined
    const presetWeightBase = override?.approvalConcentrationPreset
      ? concentrationWeightsForPreset(override.approvalConcentrationPreset)
      : baseRequirement.approvalConcentrationWeights
    const nextPreset =
      override?.approvalConcentrationPreset !== undefined
        ? override.approvalConcentrationPreset
        : hasWeightOverride
          ? null
          : baseRequirement.approvalConcentrationPreset
    const baseWeights = presetWeightBase
    return ApprovalRequirement.parse({
      ...baseRequirement,
      ...override,
      approvalConcentrationPreset: hasWeightOverride ? null : nextPreset,
      approvalConcentrationWeights: override?.approvalConcentrationWeights
        ? {
            ...baseWeights,
            ...override.approvalConcentrationWeights,
          }
        : baseWeights,
    })
  }

  function approvalReasons(bundle: DecisionBundleLike, approval: ApprovalArtifactLike) {
    const reasons: string[] = []
    if (approval.source !== bundle.source) {
      reasons.push(`approval source mismatch: ${approval.source} vs ${bundle.source}`)
    }
    if (approval.decisionBundle.source !== bundle.source) {
      reasons.push(`decision bundle source mismatch: ${approval.decisionBundle.source} vs ${bundle.source}`)
    }
    if (approval.decisionBundle.createdAt !== bundle.createdAt) {
      reasons.push(`decision bundle createdAt mismatch: ${approval.decisionBundle.createdAt} vs ${bundle.createdAt}`)
    }
    if (approval.decisionBundle.decision !== bundle.eligibility.decision) {
      reasons.push(
        `eligibility decision mismatch: ${approval.decisionBundle.decision} vs ${bundle.eligibility.decision}`,
      )
    }
    if (approval.decisionBundle.requiredOverride !== bundle.eligibility.requiredOverride) {
      reasons.push(
        `required override mismatch: ${approval.decisionBundle.requiredOverride} vs ${bundle.eligibility.requiredOverride}`,
      )
    }
    return reasons
  }

  export function merge(base: Policy, overrides?: PolicyOverrides): Policy {
    return Policy.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-approval-policy",
      rules: {
        none: mergeRequirement(base.rules.none, overrides?.none),
        allow_warn: mergeRequirement(base.rules.allow_warn, overrides?.allowWarn),
        force: mergeRequirement(base.rules.force, overrides?.force),
        reentry: mergeRequirement(base.rules.reentry, overrides?.reentry),
      },
    })
  }

  export function defaults(input?: PolicyOverrides): Policy {
    return merge(
      {
        schemaVersion: 1,
        kind: "ax-code-quality-promotion-approval-policy",
        rules: {
          none: {
            minimumApprovals: 0,
            minimumRole: null,
            requireDistinctApprovers: false,
            requireIndependentReviewer: false,
            requirePriorApproverExclusion: false,
            maxPriorApproverOverlapRatio: null,
            reviewerCarryoverBudget: null,
            reviewerCarryoverLookbackPromotions: null,
            teamCarryoverBudget: null,
            teamCarryoverLookbackPromotions: null,
            maxPriorReportingChainOverlapRatio: null,
            reportingChainCarryoverBudget: null,
            reportingChainCarryoverLookbackPromotions: null,
            requireRoleCohortDiversity: false,
            minimumDistinctRoleCohorts: null,
            requireReviewerTeamDiversity: false,
            minimumDistinctReviewerTeams: null,
            requireReportingChainDiversity: false,
            minimumDistinctReportingChains: null,
            approvalConcentrationBudget: null,
            approvalConcentrationPreset: null,
            approvalConcentrationWeights: DEFAULT_APPROVAL_CONCENTRATION_WEIGHTS,
          },
          allow_warn: {
            minimumApprovals: 1,
            minimumRole: "staff-engineer",
            requireDistinctApprovers: true,
            requireIndependentReviewer: false,
            requirePriorApproverExclusion: false,
            maxPriorApproverOverlapRatio: null,
            reviewerCarryoverBudget: null,
            reviewerCarryoverLookbackPromotions: null,
            teamCarryoverBudget: null,
            teamCarryoverLookbackPromotions: null,
            maxPriorReportingChainOverlapRatio: null,
            reportingChainCarryoverBudget: null,
            reportingChainCarryoverLookbackPromotions: null,
            requireRoleCohortDiversity: false,
            minimumDistinctRoleCohorts: null,
            requireReviewerTeamDiversity: false,
            minimumDistinctReviewerTeams: null,
            requireReportingChainDiversity: false,
            minimumDistinctReportingChains: null,
            approvalConcentrationBudget: null,
            approvalConcentrationPreset: null,
            approvalConcentrationWeights: DEFAULT_APPROVAL_CONCENTRATION_WEIGHTS,
          },
          force: {
            minimumApprovals: 2,
            minimumRole: "manager",
            requireDistinctApprovers: true,
            requireIndependentReviewer: false,
            requirePriorApproverExclusion: false,
            maxPriorApproverOverlapRatio: null,
            reviewerCarryoverBudget: null,
            reviewerCarryoverLookbackPromotions: null,
            teamCarryoverBudget: null,
            teamCarryoverLookbackPromotions: null,
            maxPriorReportingChainOverlapRatio: null,
            reportingChainCarryoverBudget: null,
            reportingChainCarryoverLookbackPromotions: null,
            requireRoleCohortDiversity: false,
            minimumDistinctRoleCohorts: null,
            requireReviewerTeamDiversity: false,
            minimumDistinctReviewerTeams: null,
            requireReportingChainDiversity: false,
            minimumDistinctReportingChains: null,
            approvalConcentrationBudget: null,
            approvalConcentrationPreset: null,
            approvalConcentrationWeights: DEFAULT_APPROVAL_CONCENTRATION_WEIGHTS,
          },
          reentry: {
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
          },
        },
      },
      input,
    )
  }

  export function resolveRequirement(input: { bundle: DecisionBundleLike; policy?: Policy }) {
    const policy = input.policy ?? defaults()
    const requiredOverride = input.bundle.eligibility.requiredOverride
    const baseRequirement = policy.rules[requiredOverride]
    const reentryApplicable =
      input.bundle.eligibility.reentryContext !== null && input.bundle.eligibility.reentryContext !== undefined
    const reentryRequirement = reentryApplicable ? policy.rules.reentry : null
    const requirement = reentryRequirement
      ? ApprovalRequirement.parse({
          minimumApprovals: Math.max(baseRequirement.minimumApprovals, reentryRequirement.minimumApprovals),
          minimumRole: stricterRole(baseRequirement.minimumRole, reentryRequirement.minimumRole),
          requireDistinctApprovers:
            baseRequirement.requireDistinctApprovers || reentryRequirement.requireDistinctApprovers,
          requireIndependentReviewer:
            baseRequirement.requireIndependentReviewer || reentryRequirement.requireIndependentReviewer,
          requirePriorApproverExclusion:
            baseRequirement.requirePriorApproverExclusion || reentryRequirement.requirePriorApproverExclusion,
          maxPriorApproverOverlapRatio: stricterOverlapRatioCap(
            baseRequirement.maxPriorApproverOverlapRatio,
            reentryRequirement.maxPriorApproverOverlapRatio,
          ),
          reviewerCarryoverBudget: stricterOverlapRatioCap(
            baseRequirement.reviewerCarryoverBudget,
            reentryRequirement.reviewerCarryoverBudget,
          ),
          reviewerCarryoverLookbackPromotions:
            reentryRequirement.reviewerCarryoverLookbackPromotions ??
            baseRequirement.reviewerCarryoverLookbackPromotions,
          teamCarryoverBudget: stricterOverlapRatioCap(
            baseRequirement.teamCarryoverBudget,
            reentryRequirement.teamCarryoverBudget,
          ),
          teamCarryoverLookbackPromotions:
            reentryRequirement.teamCarryoverLookbackPromotions ?? baseRequirement.teamCarryoverLookbackPromotions,
          maxPriorReportingChainOverlapRatio: stricterOverlapRatioCap(
            baseRequirement.maxPriorReportingChainOverlapRatio,
            reentryRequirement.maxPriorReportingChainOverlapRatio,
          ),
          reportingChainCarryoverBudget: stricterOverlapRatioCap(
            baseRequirement.reportingChainCarryoverBudget,
            reentryRequirement.reportingChainCarryoverBudget,
          ),
          reportingChainCarryoverLookbackPromotions:
            reentryRequirement.reportingChainCarryoverLookbackPromotions ??
            baseRequirement.reportingChainCarryoverLookbackPromotions,
          requireRoleCohortDiversity:
            baseRequirement.requireRoleCohortDiversity || reentryRequirement.requireRoleCohortDiversity,
          minimumDistinctRoleCohorts: stricterMinimumCount(
            baseRequirement.minimumDistinctRoleCohorts,
            reentryRequirement.minimumDistinctRoleCohorts,
          ),
          requireReviewerTeamDiversity:
            baseRequirement.requireReviewerTeamDiversity || reentryRequirement.requireReviewerTeamDiversity,
          minimumDistinctReviewerTeams: stricterMinimumCount(
            baseRequirement.minimumDistinctReviewerTeams,
            reentryRequirement.minimumDistinctReviewerTeams,
          ),
          requireReportingChainDiversity:
            baseRequirement.requireReportingChainDiversity || reentryRequirement.requireReportingChainDiversity,
          minimumDistinctReportingChains: stricterMinimumCount(
            baseRequirement.minimumDistinctReportingChains,
            reentryRequirement.minimumDistinctReportingChains,
          ),
          approvalConcentrationBudget: stricterOverlapRatioCap(
            baseRequirement.approvalConcentrationBudget,
            reentryRequirement.approvalConcentrationBudget,
          ),
          approvalConcentrationPreset: reentryRequirement.approvalConcentrationPreset,
          approvalConcentrationWeights: reentryRequirement.approvalConcentrationWeights,
        })
      : baseRequirement

    return {
      requiredOverride,
      reentryApplicable,
      reentryContextRollbackID: input.bundle.eligibility.reentryContext?.rollbackID ?? null,
      baseRequirement,
      reentryRequirement,
      requirement,
      policy,
    }
  }

  export function evaluate(input: {
    bundle: DecisionBundleLike
    approvals: ApprovalArtifactLike[]
    policy?: Policy
    policySource?: PolicySource
    policyProjectID?: string | null
  }): EvaluationSummary {
    const resolved = resolveRequirement({
      bundle: input.bundle,
      policy: input.policy,
    })
    const policy = resolved.policy
    const policySource = input.policySource ?? (input.policy ? "explicit" : "default")
    const requiredOverride = resolved.requiredOverride
    const requirement = resolved.requirement
    const remediationAuthor = input.bundle.eligibility.remediation?.author ?? null
    const independentReviewRequired = resolved.reentryApplicable && requirement.requireIndependentReviewer
    const priorApproverExclusionRequired = resolved.reentryApplicable && requirement.requirePriorApproverExclusion
    const maxPriorApproverOverlapRatio = resolved.reentryApplicable ? requirement.maxPriorApproverOverlapRatio : null
    const reviewerCarryoverBudget = resolved.reentryApplicable ? requirement.reviewerCarryoverBudget : null
    const reviewerCarryoverLookbackPromotions = resolved.reentryApplicable
      ? requirement.reviewerCarryoverLookbackPromotions
      : null
    const teamCarryoverBudget = resolved.reentryApplicable ? requirement.teamCarryoverBudget : null
    const teamCarryoverLookbackPromotions = resolved.reentryApplicable
      ? requirement.teamCarryoverLookbackPromotions
      : null
    const maxPriorReportingChainOverlapRatio = resolved.reentryApplicable
      ? requirement.maxPriorReportingChainOverlapRatio
      : null
    const reportingChainCarryoverBudget = resolved.reentryApplicable ? requirement.reportingChainCarryoverBudget : null
    const reportingChainCarryoverLookbackPromotions = resolved.reentryApplicable
      ? requirement.reportingChainCarryoverLookbackPromotions
      : null
    const roleCohortDiversityRequired = resolved.reentryApplicable && requirement.requireRoleCohortDiversity
    const minimumDistinctRoleCohorts = resolved.reentryApplicable ? requirement.minimumDistinctRoleCohorts : null
    const reviewerTeamDiversityRequired = resolved.reentryApplicable && requirement.requireReviewerTeamDiversity
    const minimumDistinctReviewerTeams = resolved.reentryApplicable ? requirement.minimumDistinctReviewerTeams : null
    const reportingChainDiversityRequired = resolved.reentryApplicable && requirement.requireReportingChainDiversity
    const minimumDistinctReportingChains = resolved.reentryApplicable
      ? requirement.minimumDistinctReportingChains
      : null
    const priorPromotionID = input.bundle.eligibility.reentryContext?.promotionID ?? null
    const priorPromotionApprovers = [
      ...new Set(input.bundle.eligibility.reentryContext?.priorPromotionApprovers ?? []),
    ].sort()
    const teamCarryoverHistory = [...(input.bundle.eligibility.reentryContext?.teamCarryoverHistory ?? [])].sort(
      (a, b) => {
        const byScore = b.weightedReuseScore - a.weightedReuseScore
        if (byScore !== 0) return byScore
        return a.team.localeCompare(b.team)
      },
    )
    const priorPromotionReportingChains = [
      ...new Set(input.bundle.eligibility.reentryContext?.priorPromotionReportingChains ?? []),
    ].sort()
    const reviewerCarryoverHistory = [
      ...(input.bundle.eligibility.reentryContext?.reviewerCarryoverHistory ?? []),
    ].sort((a, b) => {
      const byScore = b.weightedReuseScore - a.weightedReuseScore
      if (byScore !== 0) return byScore
      return a.approver.localeCompare(b.approver)
    })
    const reviewerCarryoverByApprover = new Map(
      reviewerCarryoverHistory.map((entry) => [entry.approver, entry] as const),
    )
    const teamCarryoverByTeam = new Map(teamCarryoverHistory.map((entry) => [entry.team, entry] as const))
    const reportingChainCarryoverHistory = [
      ...(input.bundle.eligibility.reentryContext?.reportingChainCarryoverHistory ?? []),
    ].sort((a, b) => {
      const byScore = b.weightedReuseScore - a.weightedReuseScore
      if (byScore !== 0) return byScore
      return a.reportingChain.localeCompare(b.reportingChain)
    })
    const reportingChainCarryoverByChain = new Map(
      reportingChainCarryoverHistory.map((entry) => [entry.reportingChain, entry] as const),
    )
    const verified = input.approvals.map((approval) => ({
      approval,
      reasons: approvalReasons(input.bundle, approval),
      approved: approval.disposition === "approved",
    }))
    const matchingArtifacts = verified.filter((item) => item.reasons.length === 0)
    const approvedArtifacts = matchingArtifacts.filter((item) => item.approved)
    const qualifiedApprovals = approvedArtifacts.filter((item) =>
      qualifiesRole(item.approval.role, requirement.minimumRole),
    )
    const distinctQualifiedApprovers = new Set(qualifiedApprovals.map((item) => item.approval.approver)).size
    const independentQualifiedApprovals =
      independentReviewRequired && remediationAuthor
        ? qualifiedApprovals.filter((item) => item.approval.approver !== remediationAuthor)
        : qualifiedApprovals
    const effectiveQualifiedApprovers = [
      ...new Set(independentQualifiedApprovals.map((item) => item.approval.approver)),
    ].sort()
    const freshQualifiedApprovers =
      priorApproverExclusionRequired && priorPromotionApprovers.length > 0
        ? effectiveQualifiedApprovers.filter((approver) => !priorPromotionApprovers.includes(approver))
        : effectiveQualifiedApprovers
    const overlappingQualifiedApprovers =
      priorApproverExclusionRequired && priorPromotionApprovers.length > 0
        ? effectiveQualifiedApprovers.filter((approver) => priorPromotionApprovers.includes(approver))
        : []
    const priorApproverOverlapRatio =
      maxPriorApproverOverlapRatio !== null && effectiveQualifiedApprovers.length > 0
        ? overlappingQualifiedApprovers.length / effectiveQualifiedApprovers.length
        : null
    const carriedOverQualifiedApprovers =
      reviewerCarryoverBudget !== null
        ? effectiveQualifiedApprovers.filter((approver) => reviewerCarryoverByApprover.has(approver))
        : []
    const reviewerCarryoverScore =
      reviewerCarryoverBudget !== null
        ? carriedOverQualifiedApprovers.reduce(
            (sum, approver) => sum + (reviewerCarryoverByApprover.get(approver)?.weightedReuseScore ?? 0),
            0,
          )
        : 0
    const qualifiedRoleCohorts = [
      ...new Set(
        qualifiedApprovals
          .map((item) => roleCohort(item.approval.role))
          .filter((value): value is ApprovalRoleCohort => value !== null),
      ),
    ].sort()
    const distinctQualifiedRoleCohorts = qualifiedRoleCohorts.length
    const qualifiedApprovalTeamsByApprover = new Map<string, string | null>()
    for (const item of qualifiedApprovals) {
      const normalizedTeam = normalizeTeam(item.approval.team)
      if (!qualifiedApprovalTeamsByApprover.has(item.approval.approver)) {
        qualifiedApprovalTeamsByApprover.set(item.approval.approver, normalizedTeam)
      } else if (normalizedTeam && qualifiedApprovalTeamsByApprover.get(item.approval.approver) === null) {
        qualifiedApprovalTeamsByApprover.set(item.approval.approver, normalizedTeam)
      }
    }
    const qualifiedReviewerTeams = [
      ...new Set([...qualifiedApprovalTeamsByApprover.values()].filter((value): value is string => value !== null)),
    ].sort()
    const distinctQualifiedReviewerTeams = qualifiedReviewerTeams.length
    const missingQualifiedReviewerTeams = [...qualifiedApprovalTeamsByApprover.values()].filter(
      (value) => value === null,
    ).length
    const effectiveQualifiedTeams = [
      ...new Set(
        effectiveQualifiedApprovers
          .map((approver) => qualifiedApprovalTeamsByApprover.get(approver) ?? null)
          .filter((value): value is string => value !== null),
      ),
    ].sort()
    const carriedOverQualifiedTeams =
      teamCarryoverBudget !== null ? effectiveQualifiedTeams.filter((team) => teamCarryoverByTeam.has(team)) : []
    const teamCarryoverScore =
      teamCarryoverBudget !== null
        ? carriedOverQualifiedTeams.reduce(
            (sum, team) => sum + (teamCarryoverByTeam.get(team)?.weightedReuseScore ?? 0),
            0,
          )
        : 0
    const qualifiedApprovalReportingChainsByApprover = new Map<string, string | null>()
    for (const item of qualifiedApprovals) {
      const normalizedReportingChain = normalizeReportingChain(item.approval.reportingChain)
      if (!qualifiedApprovalReportingChainsByApprover.has(item.approval.approver)) {
        qualifiedApprovalReportingChainsByApprover.set(item.approval.approver, normalizedReportingChain)
      } else if (
        normalizedReportingChain &&
        qualifiedApprovalReportingChainsByApprover.get(item.approval.approver) === null
      ) {
        qualifiedApprovalReportingChainsByApprover.set(item.approval.approver, normalizedReportingChain)
      }
    }
    const qualifiedReportingChains = [
      ...new Set(
        [...qualifiedApprovalReportingChainsByApprover.values()].filter((value): value is string => value !== null),
      ),
    ].sort()
    const distinctQualifiedReportingChains = qualifiedReportingChains.length
    const missingQualifiedReportingChains = [...qualifiedApprovalReportingChainsByApprover.values()].filter(
      (value) => value === null,
    ).length
    const effectiveQualifiedReportingChains = [
      ...new Set(
        effectiveQualifiedApprovers
          .map((approver) => qualifiedApprovalReportingChainsByApprover.get(approver) ?? null)
          .filter((value): value is string => value !== null),
      ),
    ].sort()
    const overlappingQualifiedReportingChains =
      maxPriorReportingChainOverlapRatio !== null && priorPromotionReportingChains.length > 0
        ? effectiveQualifiedReportingChains.filter((reportingChain) =>
            priorPromotionReportingChains.includes(reportingChain),
          )
        : []
    const priorReportingChainOverlapRatio =
      maxPriorReportingChainOverlapRatio !== null && effectiveQualifiedReportingChains.length > 0
        ? overlappingQualifiedReportingChains.length / effectiveQualifiedReportingChains.length
        : null
    const carriedOverQualifiedReportingChains =
      reportingChainCarryoverBudget !== null
        ? effectiveQualifiedReportingChains.filter((reportingChain) =>
            reportingChainCarryoverByChain.has(reportingChain),
          )
        : []
    const reportingChainCarryoverScore =
      reportingChainCarryoverBudget !== null
        ? carriedOverQualifiedReportingChains.reduce(
            (sum, reportingChain) =>
              sum + (reportingChainCarryoverByChain.get(reportingChain)?.weightedReuseScore ?? 0),
            0,
          )
        : 0
    const approverReuseRatio =
      reviewerCarryoverHistory.length > 0 && effectiveQualifiedApprovers.length > 0
        ? carriedOverQualifiedApprovers.length / effectiveQualifiedApprovers.length
        : null
    const teamReuseRatio =
      teamCarryoverHistory.length > 0 && effectiveQualifiedTeams.length > 0
        ? carriedOverQualifiedTeams.length / effectiveQualifiedTeams.length
        : null
    const reportingChainReuseRatio =
      reportingChainCarryoverHistory.length > 0 && effectiveQualifiedReportingChains.length > 0
        ? carriedOverQualifiedReportingChains.length / effectiveQualifiedReportingChains.length
        : null
    const approvalConcentrationBudget = resolved.reentryApplicable ? requirement.approvalConcentrationBudget : null
    const approvalConcentrationPreset = requirement.approvalConcentrationPreset
    const approvalConcentrationWeights = requirement.approvalConcentrationWeights
    const approvalConcentrationComponents = [
      approverReuseRatio !== null
        ? { axis: "approver" as const, ratio: approverReuseRatio, weight: approvalConcentrationWeights.approver }
        : null,
      teamReuseRatio !== null
        ? { axis: "team" as const, ratio: teamReuseRatio, weight: approvalConcentrationWeights.team }
        : null,
      reportingChainReuseRatio !== null
        ? {
            axis: "reporting_chain" as const,
            ratio: reportingChainReuseRatio,
            weight: approvalConcentrationWeights.reportingChain,
          }
        : null,
    ].filter(
      (value): value is { axis: "approver" | "team" | "reporting_chain"; ratio: number; weight: number } =>
        value !== null && value.weight > 0,
    )
    const approvalConcentrationApplicableAxes = approvalConcentrationComponents.map((component) => component.axis)
    const approvalConcentrationAppliedWeightTotal =
      approvalConcentrationComponents.length > 0
        ? approvalConcentrationComponents.reduce((sum, component) => sum + component.weight, 0)
        : null
    const approvalConcentrationScore =
      approvalConcentrationAppliedWeightTotal && approvalConcentrationAppliedWeightTotal > 0
        ? approvalConcentrationComponents.reduce((sum, component) => sum + component.ratio * component.weight, 0) /
          approvalConcentrationAppliedWeightTotal
        : null

    const gates: PolicyGate[] = [
      {
        name: "reentry-requirement",
        status: !resolved.reentryApplicable || resolved.reentryRequirement === null ? "pass" : "pass",
        detail:
          !resolved.reentryApplicable || resolved.reentryRequirement === null
            ? "reentry approval not required"
            : `reentry approval applies from rollback ${resolved.reentryContextRollbackID}; minimumApprovals=${resolved.reentryRequirement.minimumApprovals}; minimumRole=${resolved.reentryRequirement.minimumRole ?? "none"}`,
      },
      {
        name: "reentry-remediation-context",
        status: !independentReviewRequired || remediationAuthor !== null ? "pass" : "fail",
        detail: !independentReviewRequired
          ? "independent reviewer not required"
          : remediationAuthor !== null
            ? `remediation author=${remediationAuthor}`
            : "reentry approval requires remediation artifact with author provenance",
      },
      {
        name: "prior-approver-context",
        status: !priorApproverExclusionRequired || priorPromotionID !== null ? "pass" : "fail",
        detail: !priorApproverExclusionRequired
          ? "prior approver exclusion not required"
          : priorPromotionID !== null
            ? priorPromotionApprovers.length > 0
              ? `prior promotion=${priorPromotionID}; recorded approvers=${priorPromotionApprovers.join(", ")}`
              : `prior promotion=${priorPromotionID}; no prior approvers recorded`
            : "prior approver exclusion requires prior promotion provenance",
      },
      {
        name: "prior-reporting-chain-context",
        status:
          maxPriorReportingChainOverlapRatio === null ||
          reportingChainCarryoverHistory.length === 0 ||
          priorPromotionID === null ||
          priorPromotionReportingChains.length > 0
            ? "pass"
            : "fail",
        detail:
          maxPriorReportingChainOverlapRatio === null
            ? "prior reporting chain overlap cap not configured"
            : reportingChainCarryoverHistory.length === 0
              ? "no prior reentry reporting chain carryover history recorded"
              : priorPromotionID === null
                ? "prior reporting chain overlap not applicable without prior promotion provenance"
                : priorPromotionReportingChains.length > 0
                  ? `prior promotion=${priorPromotionID}; recorded reporting chains=${priorPromotionReportingChains.join(", ")}`
                  : "prior reporting chain overlap requires prior promotion reporting chain provenance",
      },
      {
        name: "artifact-match",
        status: verified.every((item) => item.reasons.length === 0) ? "pass" : "fail",
        detail: verified.every((item) => item.reasons.length === 0)
          ? `${matchingArtifacts.length} approval artifact(s) match the decision bundle`
          : verified
              .filter((item) => item.reasons.length > 0)
              .map((item) => item.reasons[0]!)
              .join("; "),
      },
      {
        name: "approved-disposition",
        status: matchingArtifacts.length === approvedArtifacts.length ? "pass" : "fail",
        detail: `${approvedArtifacts.length} of ${matchingArtifacts.length} matching artifact(s) are approved`,
      },
      {
        name: "independent-reviewer",
        status:
          !independentReviewRequired || remediationAuthor === null || independentQualifiedApprovals.length > 0
            ? "pass"
            : "fail",
        detail: !independentReviewRequired
          ? "independent reviewer not required"
          : remediationAuthor === null
            ? "independent reviewer cannot be evaluated without remediation author"
            : `${independentQualifiedApprovals.length} independent qualified approval(s); remediation author=${remediationAuthor}`,
      },
      {
        name: "fresh-approver",
        status:
          !priorApproverExclusionRequired || priorPromotionApprovers.length === 0 || freshQualifiedApprovers.length > 0
            ? "pass"
            : "fail",
        detail: !priorApproverExclusionRequired
          ? "prior approver exclusion not required"
          : priorPromotionApprovers.length === 0
            ? "no prior approved approvers recorded"
            : `${freshQualifiedApprovers.length} fresh qualified approver(s); excluded prior approvers=${priorPromotionApprovers.join(", ")}`,
      },
      {
        name: "prior-approver-overlap",
        status:
          !priorApproverExclusionRequired ||
          maxPriorApproverOverlapRatio === null ||
          priorPromotionApprovers.length === 0 ||
          priorApproverOverlapRatio === null ||
          priorApproverOverlapRatio <= maxPriorApproverOverlapRatio
            ? "pass"
            : "fail",
        detail: !priorApproverExclusionRequired
          ? "prior approver exclusion not required"
          : maxPriorApproverOverlapRatio === null
            ? "prior approver overlap cap not configured"
            : priorPromotionApprovers.length === 0
              ? "no prior approved approvers recorded"
              : priorApproverOverlapRatio === null
                ? "no effective qualified approvers available for overlap evaluation"
                : `${overlappingQualifiedApprovers.length} overlapping effective approver(s) across ${effectiveQualifiedApprovers.length} effective approver(s); ratio=${priorApproverOverlapRatio.toFixed(2)}; cap=${maxPriorApproverOverlapRatio.toFixed(2)}`,
      },
      {
        name: "reviewer-carryover-budget",
        status:
          reviewerCarryoverBudget === null ||
          reviewerCarryoverHistory.length === 0 ||
          reviewerCarryoverScore <= reviewerCarryoverBudget
            ? "pass"
            : "fail",
        detail:
          reviewerCarryoverBudget === null
            ? "reviewer carryover budget not configured"
            : reviewerCarryoverHistory.length === 0
              ? "no prior reentry reviewer carryover history recorded"
              : `${carriedOverQualifiedApprovers.length} carried-over approver(s); score=${reviewerCarryoverScore.toFixed(2)}; budget=${reviewerCarryoverBudget.toFixed(2)}; lookback=${reviewerCarryoverLookbackPromotions ?? "n/a"}; approvers=${carriedOverQualifiedApprovers.join(", ") || "none"}`,
      },
      {
        name: "team-carryover-budget",
        status:
          teamCarryoverBudget === null || teamCarryoverHistory.length === 0 || teamCarryoverScore <= teamCarryoverBudget
            ? "pass"
            : "fail",
        detail:
          teamCarryoverBudget === null
            ? "team carryover budget not configured"
            : teamCarryoverHistory.length === 0
              ? "no prior reentry team carryover history recorded"
              : `${carriedOverQualifiedTeams.length} carried-over team(s); score=${teamCarryoverScore.toFixed(2)}; budget=${teamCarryoverBudget.toFixed(2)}; lookback=${teamCarryoverLookbackPromotions ?? "n/a"}; teams=${carriedOverQualifiedTeams.join(", ") || "none"}`,
      },
      {
        name: "prior-reporting-chain-overlap",
        status:
          maxPriorReportingChainOverlapRatio === null ||
          reportingChainCarryoverHistory.length === 0 ||
          priorPromotionReportingChains.length === 0 ||
          priorReportingChainOverlapRatio === null ||
          priorReportingChainOverlapRatio <= maxPriorReportingChainOverlapRatio
            ? "pass"
            : "fail",
        detail:
          maxPriorReportingChainOverlapRatio === null
            ? "prior reporting chain overlap cap not configured"
            : reportingChainCarryoverHistory.length === 0
              ? "no prior reentry reporting chain carryover history recorded"
              : priorPromotionReportingChains.length === 0
                ? "no prior promotion reporting chains recorded"
                : priorReportingChainOverlapRatio === null
                  ? "no effective qualified reporting chains available for overlap evaluation"
                  : `${overlappingQualifiedReportingChains.length} overlapping effective reporting chain(s) across ${effectiveQualifiedReportingChains.length} effective reporting chain(s); ratio=${priorReportingChainOverlapRatio.toFixed(2)}; cap=${maxPriorReportingChainOverlapRatio.toFixed(2)}`,
      },
      {
        name: "reporting-chain-carryover-budget",
        status:
          reportingChainCarryoverBudget === null ||
          reportingChainCarryoverHistory.length === 0 ||
          reportingChainCarryoverScore <= reportingChainCarryoverBudget
            ? "pass"
            : "fail",
        detail:
          reportingChainCarryoverBudget === null
            ? "reporting chain carryover budget not configured"
            : reportingChainCarryoverHistory.length === 0
              ? "no prior reentry reporting chain carryover history recorded"
              : `${carriedOverQualifiedReportingChains.length} carried-over reporting chain(s); score=${reportingChainCarryoverScore.toFixed(2)}; budget=${reportingChainCarryoverBudget.toFixed(2)}; lookback=${reportingChainCarryoverLookbackPromotions ?? "n/a"}; chains=${carriedOverQualifiedReportingChains.join(", ") || "none"}`,
      },
      {
        name: "approval-concentration",
        status:
          approvalConcentrationBudget === null ||
          approvalConcentrationApplicableAxes.length === 0 ||
          approvalConcentrationScore === null ||
          approvalConcentrationScore <= approvalConcentrationBudget
            ? "pass"
            : "fail",
        detail:
          approvalConcentrationBudget === null
            ? "approval concentration budget not configured"
            : approvalConcentrationApplicableAxes.length === 0 || approvalConcentrationScore === null
              ? "no reusable approval concentration axes available"
              : `score=${approvalConcentrationScore.toFixed(2)}; budget=${approvalConcentrationBudget.toFixed(2)}; weight_total=${approvalConcentrationAppliedWeightTotal?.toFixed(2) ?? "n/a"}; weights=approver:${approvalConcentrationWeights.approver.toFixed(2)},team:${approvalConcentrationWeights.team.toFixed(2)},reporting_chain:${approvalConcentrationWeights.reportingChain.toFixed(2)}; approver=${approverReuseRatio?.toFixed(2) ?? "n/a"}; team=${teamReuseRatio?.toFixed(2) ?? "n/a"}; reporting_chain=${reportingChainReuseRatio?.toFixed(2) ?? "n/a"}`,
      },
      {
        name: "role-cohort-diversity",
        status:
          !roleCohortDiversityRequired ||
          reviewerCarryoverHistory.length === 0 ||
          minimumDistinctRoleCohorts === null ||
          distinctQualifiedRoleCohorts >= minimumDistinctRoleCohorts
            ? "pass"
            : "fail",
        detail: !roleCohortDiversityRequired
          ? "role cohort diversity not required"
          : reviewerCarryoverHistory.length === 0
            ? "no prior reentry reviewer carryover history recorded"
            : minimumDistinctRoleCohorts === null
              ? "minimum distinct role cohorts not configured"
              : `${distinctQualifiedRoleCohorts} distinct role cohort(s); required=${minimumDistinctRoleCohorts}; cohorts=${qualifiedRoleCohorts.join(", ") || "none"}`,
      },
      {
        name: "reviewer-team-provenance",
        status:
          !reviewerTeamDiversityRequired || reviewerCarryoverHistory.length === 0 || missingQualifiedReviewerTeams === 0
            ? "pass"
            : "fail",
        detail: !reviewerTeamDiversityRequired
          ? "reviewer team diversity not required"
          : reviewerCarryoverHistory.length === 0
            ? "no prior reentry reviewer carryover history recorded"
            : `${missingQualifiedReviewerTeams} qualified approver(s) missing team provenance`,
      },
      {
        name: "reviewer-team-diversity",
        status:
          !reviewerTeamDiversityRequired ||
          reviewerCarryoverHistory.length === 0 ||
          minimumDistinctReviewerTeams === null ||
          (missingQualifiedReviewerTeams === 0 && distinctQualifiedReviewerTeams >= minimumDistinctReviewerTeams)
            ? "pass"
            : "fail",
        detail: !reviewerTeamDiversityRequired
          ? "reviewer team diversity not required"
          : reviewerCarryoverHistory.length === 0
            ? "no prior reentry reviewer carryover history recorded"
            : minimumDistinctReviewerTeams === null
              ? "minimum distinct reviewer teams not configured"
              : missingQualifiedReviewerTeams > 0
                ? `cannot evaluate reviewer team diversity; missing team provenance for ${missingQualifiedReviewerTeams} qualified approver(s)`
                : `${distinctQualifiedReviewerTeams} distinct reviewer team(s); required=${minimumDistinctReviewerTeams}; teams=${qualifiedReviewerTeams.join(", ") || "none"}`,
      },
      {
        name: "reporting-chain-provenance",
        status:
          !reportingChainDiversityRequired ||
          reviewerCarryoverHistory.length === 0 ||
          missingQualifiedReportingChains === 0
            ? "pass"
            : "fail",
        detail: !reportingChainDiversityRequired
          ? "reporting chain diversity not required"
          : reviewerCarryoverHistory.length === 0
            ? "no prior reentry reviewer carryover history recorded"
            : `${missingQualifiedReportingChains} qualified approver(s) missing reporting chain provenance`,
      },
      {
        name: "reporting-chain-diversity",
        status:
          !reportingChainDiversityRequired ||
          reviewerCarryoverHistory.length === 0 ||
          minimumDistinctReportingChains === null ||
          (missingQualifiedReportingChains === 0 && distinctQualifiedReportingChains >= minimumDistinctReportingChains)
            ? "pass"
            : "fail",
        detail: !reportingChainDiversityRequired
          ? "reporting chain diversity not required"
          : reviewerCarryoverHistory.length === 0
            ? "no prior reentry reviewer carryover history recorded"
            : minimumDistinctReportingChains === null
              ? "minimum distinct reporting chains not configured"
              : missingQualifiedReportingChains > 0
                ? `cannot evaluate reporting chain diversity; missing reporting chain provenance for ${missingQualifiedReportingChains} qualified approver(s)`
                : `${distinctQualifiedReportingChains} distinct reporting chain(s); required=${minimumDistinctReportingChains}; chains=${qualifiedReportingChains.join(", ") || "none"}`,
      },
      {
        name: "minimum-role",
        status:
          requirement.minimumRole === null || approvedArtifacts.length === qualifiedApprovals.length ? "pass" : "fail",
        detail:
          requirement.minimumRole === null
            ? "no minimum role required"
            : `${qualifiedApprovals.length} approval(s) meet minimum role ${requirement.minimumRole}`,
      },
      {
        name: "approval-count",
        status: qualifiedApprovals.length >= requirement.minimumApprovals ? "pass" : "fail",
        detail: `${qualifiedApprovals.length} qualified approval(s); required=${requirement.minimumApprovals}`,
      },
      {
        name: "distinct-approvers",
        status:
          !requirement.requireDistinctApprovers || distinctQualifiedApprovers >= requirement.minimumApprovals
            ? "pass"
            : "fail",
        detail: requirement.requireDistinctApprovers
          ? `${distinctQualifiedApprovers} distinct approver(s); required=${requirement.minimumApprovals}`
          : "distinct approvers not required",
      },
    ]

    return {
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-approval-evaluation",
      source: input.bundle.source,
      decisionBundleCreatedAt: input.bundle.createdAt,
      requiredOverride,
      policySource,
      policyProjectID: input.policyProjectID ?? null,
      policy,
      reentryApplicable: resolved.reentryApplicable,
      reentryContextRollbackID: resolved.reentryContextRollbackID,
      baseRequirement: resolved.baseRequirement,
      reentryRequirement: resolved.reentryRequirement,
      requirement,
      independentReviewRequired,
      priorApproverExclusionRequired,
      maxPriorApproverOverlapRatio,
      reviewerCarryoverBudget,
      reviewerCarryoverLookbackPromotions,
      teamCarryoverBudget,
      teamCarryoverLookbackPromotions,
      maxPriorReportingChainOverlapRatio,
      reportingChainCarryoverBudget,
      reportingChainCarryoverLookbackPromotions,
      roleCohortDiversityRequired,
      minimumDistinctRoleCohorts,
      reviewerTeamDiversityRequired,
      minimumDistinctReviewerTeams,
      reportingChainDiversityRequired,
      minimumDistinctReportingChains,
      remediationAuthor,
      independentQualifiedApprovals: independentQualifiedApprovals.length,
      priorPromotionID,
      priorPromotionApprovers,
      teamCarryoverHistory,
      priorPromotionReportingChains,
      reviewerCarryoverHistory,
      reportingChainCarryoverHistory,
      freshQualifiedApprovals: freshQualifiedApprovers.length,
      overlappingQualifiedApprovers: overlappingQualifiedApprovers.length,
      priorApproverOverlapRatio,
      reviewerCarryoverScore,
      carriedOverQualifiedApprovers: carriedOverQualifiedApprovers.length,
      teamCarryoverScore,
      carriedOverQualifiedTeams: carriedOverQualifiedTeams.length,
      overlappingQualifiedReportingChains: overlappingQualifiedReportingChains.length,
      priorReportingChainOverlapRatio,
      reportingChainCarryoverScore,
      carriedOverQualifiedReportingChains: carriedOverQualifiedReportingChains.length,
      qualifiedRoleCohorts,
      distinctQualifiedRoleCohorts,
      qualifiedReviewerTeams,
      distinctQualifiedReviewerTeams,
      missingQualifiedReviewerTeams,
      qualifiedReportingChains,
      distinctQualifiedReportingChains,
      missingQualifiedReportingChains,
      approverReuseRatio,
      teamReuseRatio,
      reportingChainReuseRatio,
      approvalConcentrationBudget,
      approvalConcentrationPreset,
      approvalConcentrationWeights,
      approvalConcentrationScore,
      approvalConcentrationApplicableAxes,
      approvalConcentrationAppliedWeightTotal,
      providedApprovals: input.approvals.length,
      approvedArtifacts: approvedArtifacts.length,
      matchingArtifacts: matchingArtifacts.length,
      qualifiedApprovals: qualifiedApprovals.length,
      distinctQualifiedApprovers,
      overallStatus: gates.every((gate) => gate.status === "pass") ? "pass" : "fail",
      acceptedApprovals: qualifiedApprovals.map((item) => ({
        approvalID: item.approval.approvalID,
        approver: item.approval.approver,
        role: item.approval.role,
        team: item.approval.team ?? null,
        reportingChain: item.approval.reportingChain ?? null,
        approvedAt: item.approval.approvedAt,
      })),
      gates,
    }
  }

  export function renderReport(summary: EvaluationSummary) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion approval policy")
    lines.push("")
    lines.push(`- source: ${summary.source}`)
    lines.push(`- decision bundle created at: ${summary.decisionBundleCreatedAt}`)
    lines.push(`- required override: ${summary.requiredOverride}`)
    lines.push(`- policy source: ${summary.policySource}`)
    lines.push(`- policy project id: ${summary.policyProjectID ?? "n/a"}`)
    lines.push(`- overall status: ${summary.overallStatus}`)
    lines.push(`- reentry applicable: ${summary.reentryApplicable}`)
    lines.push(`- reentry rollback id: ${summary.reentryContextRollbackID ?? "n/a"}`)
    lines.push(`- base approvals: ${summary.baseRequirement.minimumApprovals}`)
    lines.push(`- base minimum role: ${summary.baseRequirement.minimumRole ?? "none"}`)
    lines.push(`- reentry approvals: ${summary.reentryRequirement?.minimumApprovals ?? "n/a"}`)
    lines.push(`- reentry minimum role: ${summary.reentryRequirement?.minimumRole ?? "n/a"}`)
    lines.push(`- independent review required: ${summary.independentReviewRequired}`)
    lines.push(`- prior approver exclusion required: ${summary.priorApproverExclusionRequired}`)
    lines.push(`- max prior approver overlap ratio: ${summary.maxPriorApproverOverlapRatio ?? "none"}`)
    lines.push(`- reviewer carryover budget: ${summary.reviewerCarryoverBudget ?? "none"}`)
    lines.push(`- reviewer carryover lookback promotions: ${summary.reviewerCarryoverLookbackPromotions ?? "none"}`)
    lines.push(`- team carryover budget: ${summary.teamCarryoverBudget ?? "none"}`)
    lines.push(`- team carryover lookback promotions: ${summary.teamCarryoverLookbackPromotions ?? "none"}`)
    lines.push(`- max prior reporting chain overlap ratio: ${summary.maxPriorReportingChainOverlapRatio ?? "none"}`)
    lines.push(`- reporting chain carryover budget: ${summary.reportingChainCarryoverBudget ?? "none"}`)
    lines.push(
      `- reporting chain carryover lookback promotions: ${summary.reportingChainCarryoverLookbackPromotions ?? "none"}`,
    )
    lines.push(`- role cohort diversity required: ${summary.roleCohortDiversityRequired}`)
    lines.push(`- minimum distinct role cohorts: ${summary.minimumDistinctRoleCohorts ?? "none"}`)
    lines.push(`- reviewer team diversity required: ${summary.reviewerTeamDiversityRequired}`)
    lines.push(`- minimum distinct reviewer teams: ${summary.minimumDistinctReviewerTeams ?? "none"}`)
    lines.push(`- reporting chain diversity required: ${summary.reportingChainDiversityRequired}`)
    lines.push(`- minimum distinct reporting chains: ${summary.minimumDistinctReportingChains ?? "none"}`)
    lines.push(`- remediation author: ${summary.remediationAuthor ?? "n/a"}`)
    lines.push(`- independent qualified approvals: ${summary.independentQualifiedApprovals}`)
    lines.push(`- prior promotion id: ${summary.priorPromotionID ?? "n/a"}`)
    lines.push(`- prior promotion approvers: ${summary.priorPromotionApprovers.join(", ") || "n/a"}`)
    lines.push(
      `- team carryover history: ${summary.teamCarryoverHistory.map((entry) => `${entry.team}:${entry.weightedReuseScore.toFixed(2)}`).join(", ") || "n/a"}`,
    )
    lines.push(`- prior promotion reporting chains: ${summary.priorPromotionReportingChains.join(", ") || "n/a"}`)
    lines.push(
      `- reviewer carryover history: ${summary.reviewerCarryoverHistory.map((entry) => `${entry.approver}:${entry.weightedReuseScore.toFixed(2)}`).join(", ") || "n/a"}`,
    )
    lines.push(
      `- reporting chain carryover history: ${summary.reportingChainCarryoverHistory.map((entry) => `${entry.reportingChain}:${entry.weightedReuseScore.toFixed(2)}`).join(", ") || "n/a"}`,
    )
    lines.push(`- fresh qualified approvals: ${summary.freshQualifiedApprovals}`)
    lines.push(`- overlapping qualified approvers: ${summary.overlappingQualifiedApprovers}`)
    lines.push(`- prior approver overlap ratio: ${summary.priorApproverOverlapRatio ?? "n/a"}`)
    lines.push(`- reviewer carryover score: ${summary.reviewerCarryoverScore}`)
    lines.push(`- carried-over qualified approvers: ${summary.carriedOverQualifiedApprovers}`)
    lines.push(`- team carryover score: ${summary.teamCarryoverScore}`)
    lines.push(`- carried-over qualified teams: ${summary.carriedOverQualifiedTeams}`)
    lines.push(`- overlapping qualified reporting chains: ${summary.overlappingQualifiedReportingChains}`)
    lines.push(`- prior reporting chain overlap ratio: ${summary.priorReportingChainOverlapRatio ?? "n/a"}`)
    lines.push(`- reporting chain carryover score: ${summary.reportingChainCarryoverScore}`)
    lines.push(`- carried-over qualified reporting chains: ${summary.carriedOverQualifiedReportingChains}`)
    lines.push(`- qualified role cohorts: ${summary.qualifiedRoleCohorts.join(", ") || "n/a"}`)
    lines.push(`- distinct qualified role cohorts: ${summary.distinctQualifiedRoleCohorts}`)
    lines.push(`- qualified reviewer teams: ${summary.qualifiedReviewerTeams.join(", ") || "n/a"}`)
    lines.push(`- distinct qualified reviewer teams: ${summary.distinctQualifiedReviewerTeams}`)
    lines.push(`- missing qualified reviewer teams: ${summary.missingQualifiedReviewerTeams}`)
    lines.push(`- qualified reporting chains: ${summary.qualifiedReportingChains.join(", ") || "n/a"}`)
    lines.push(`- distinct qualified reporting chains: ${summary.distinctQualifiedReportingChains}`)
    lines.push(`- missing qualified reporting chains: ${summary.missingQualifiedReportingChains}`)
    lines.push(`- approver reuse ratio: ${summary.approverReuseRatio ?? "n/a"}`)
    lines.push(`- team reuse ratio: ${summary.teamReuseRatio ?? "n/a"}`)
    lines.push(`- reporting chain reuse ratio: ${summary.reportingChainReuseRatio ?? "n/a"}`)
    lines.push(`- approval concentration budget: ${summary.approvalConcentrationBudget ?? "none"}`)
    lines.push(`- approval concentration preset: ${summary.approvalConcentrationPreset ?? "none"}`)
    lines.push(
      `- approval concentration weights: approver=${summary.approvalConcentrationWeights.approver}, team=${summary.approvalConcentrationWeights.team}, reporting_chain=${summary.approvalConcentrationWeights.reportingChain}`,
    )
    lines.push(`- approval concentration score: ${summary.approvalConcentrationScore ?? "n/a"}`)
    lines.push(`- approval concentration axes: ${summary.approvalConcentrationApplicableAxes.join(", ") || "n/a"}`)
    lines.push(
      `- approval concentration applied weight total: ${summary.approvalConcentrationAppliedWeightTotal ?? "n/a"}`,
    )
    lines.push(`- required approvals: ${summary.requirement.minimumApprovals}`)
    lines.push(`- minimum role: ${summary.requirement.minimumRole ?? "none"}`)
    lines.push(`- distinct approvers required: ${summary.requirement.requireDistinctApprovers}`)
    lines.push(`- provided approvals: ${summary.providedApprovals}`)
    lines.push(`- qualified approvals: ${summary.qualifiedApprovals}`)
    lines.push(`- distinct qualified approvers: ${summary.distinctQualifiedApprovers}`)
    lines.push("")
    lines.push("Gates:")
    for (const gate of summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    if (summary.acceptedApprovals.length > 0) {
      lines.push("")
      lines.push("Accepted Approvals:")
      for (const approval of summary.acceptedApprovals) {
        lines.push(
          `- ${approval.approvedAt} · ${approval.approver} · ${approval.role ?? "n/a"} · ${approval.team ?? "n/a"} · ${approval.reportingChain ?? "n/a"} · ${approval.approvalID}`,
        )
      }
    }
    lines.push("")
    return lines.join("\n")
  }
}
