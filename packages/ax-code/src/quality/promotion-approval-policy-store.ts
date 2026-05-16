import z from "zod"
import { Storage } from "../storage/storage"
import { QualityPromotionApprovalPolicy } from "./promotion-approval-policy"

export namespace QualityPromotionApprovalPolicyStore {
  export const Scope = z.enum(["global", "project"])
  export type Scope = z.output<typeof Scope>

  export const PolicyRecord = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-approval-policy-record"),
    scope: Scope,
    projectID: z.string().nullable(),
    updatedAt: z.string(),
    policy: z.lazy(() => QualityPromotionApprovalPolicy.Policy),
  })
  export type PolicyRecord = z.output<typeof PolicyRecord>

  export const Resolution = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-approval-policy-resolution"),
    source: z.lazy(() => QualityPromotionApprovalPolicy.PolicySource),
    projectID: z.string().nullable(),
    resolvedAt: z.string(),
    policy: z.lazy(() => QualityPromotionApprovalPolicy.Policy),
    record: PolicyRecord.nullable(),
  })
  export type Resolution = z.output<typeof Resolution>

  function encode(input: string) {
    return encodeURIComponent(input)
  }

  function decode(input: string) {
    return decodeURIComponent(input)
  }

  function requireProjectID(projectID: string | null | undefined) {
    const normalized = projectID?.trim()
    if (!normalized) throw new Error("projectID is required for project-scoped approval policies")
    return normalized
  }

  function globalKey() {
    return ["quality_model_approval_policy", "global"]
  }

  function projectKey(projectID: string) {
    return ["quality_model_approval_policy", "project", encode(projectID)]
  }

  async function writeRecord(scope: Scope, policy: QualityPromotionApprovalPolicy.Policy, projectID?: string | null) {
    const normalizedProjectID = scope === "project" ? requireProjectID(projectID) : null
    const next = PolicyRecord.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-approval-policy-record",
      scope,
      projectID: normalizedProjectID,
      updatedAt: new Date().toISOString(),
      policy,
    })
    const targetKey = scope === "project" ? projectKey(requireProjectID(normalizedProjectID)) : globalKey()
    await Storage.write(targetKey, next)
    return next
  }

  export async function getGlobal() {
    try {
      return PolicyRecord.parse(await Storage.read<unknown>(globalKey()))
    } catch (err) {
      if (Storage.NotFoundError.isInstance(err)) return
      throw err
    }
  }

  export async function getProject(projectID: string) {
    try {
      return PolicyRecord.parse(await Storage.read<unknown>(projectKey(requireProjectID(projectID))))
    } catch (err) {
      if (Storage.NotFoundError.isInstance(err)) return
      throw err
    }
  }

  export async function setGlobal(policy: QualityPromotionApprovalPolicy.Policy) {
    return writeRecord("global", policy, null)
  }

  export async function setProject(projectID: string, policy: QualityPromotionApprovalPolicy.Policy) {
    return writeRecord("project", policy, projectID)
  }

  export async function clearGlobal() {
    await Storage.remove(globalKey())
  }

  export async function clearProject(projectID: string) {
    await Storage.remove(projectKey(requireProjectID(projectID)))
  }

  export async function list() {
    const keys = await Storage.list(["quality_model_approval_policy"])
    const records: PolicyRecord[] = []
    for (const parts of keys) {
      if (parts[1] === "global") {
        const record = await getGlobal()
        if (record) records.push(record)
        continue
      }
      if (parts[1] !== "project") continue
      const encodedProjectID = parts[2]
      if (!encodedProjectID) continue
      const record = await getProject(decode(encodedProjectID))
      if (record) records.push(record)
    }
    return records.sort((a, b) => {
      const byScope = a.scope.localeCompare(b.scope)
      if (byScope !== 0) return byScope
      const byProject = (a.projectID ?? "").localeCompare(b.projectID ?? "")
      if (byProject !== 0) return byProject
      return a.updatedAt.localeCompare(b.updatedAt)
    })
  }

  export async function resolve(input?: {
    projectID?: string | null
    policy?: QualityPromotionApprovalPolicy.Policy
  }): Promise<Resolution> {
    const resolvedAt = new Date().toISOString()
    const projectID = input?.projectID?.trim() || null
    if (input?.policy) {
      return Resolution.parse({
        schemaVersion: 1,
        kind: "ax-code-quality-promotion-approval-policy-resolution",
        source: "explicit",
        projectID,
        resolvedAt,
        policy: input.policy,
        record: null,
      })
    }
    if (projectID) {
      const projectRecord = await getProject(projectID)
      if (projectRecord) {
        return Resolution.parse({
          schemaVersion: 1,
          kind: "ax-code-quality-promotion-approval-policy-resolution",
          source: "project",
          projectID,
          resolvedAt,
          policy: projectRecord.policy,
          record: projectRecord,
        })
      }
    }
    const globalRecord = await getGlobal()
    if (globalRecord) {
      return Resolution.parse({
        schemaVersion: 1,
        kind: "ax-code-quality-promotion-approval-policy-resolution",
        source: "global",
        projectID,
        resolvedAt,
        policy: globalRecord.policy,
        record: globalRecord,
      })
    }
    return Resolution.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-approval-policy-resolution",
      source: "default",
      projectID,
      resolvedAt,
      policy: QualityPromotionApprovalPolicy.defaults(),
      record: null,
    })
  }

  function pushPolicy(lines: string[], policy: QualityPromotionApprovalPolicy.Policy) {
    const formatWeights = (weights: QualityPromotionApprovalPolicy.ApprovalConcentrationWeights) =>
      `approver:${weights.approver},team:${weights.team},reporting_chain:${weights.reportingChain}`
    lines.push("")
    lines.push("Rules:")
    lines.push(
      `- none: approvals=${policy.rules.none.minimumApprovals}; role=${policy.rules.none.minimumRole ?? "none"}; distinct=${policy.rules.none.requireDistinctApprovers}; independent=${policy.rules.none.requireIndependentReviewer}; fresh=${policy.rules.none.requirePriorApproverExclusion}; overlap_cap=${policy.rules.none.maxPriorApproverOverlapRatio ?? "none"}; carryover_budget=${policy.rules.none.reviewerCarryoverBudget ?? "none"}; carryover_lookback=${policy.rules.none.reviewerCarryoverLookbackPromotions ?? "none"}; team_carryover_budget=${policy.rules.none.teamCarryoverBudget ?? "none"}; team_carryover_lookback=${policy.rules.none.teamCarryoverLookbackPromotions ?? "none"}; reporting_chain_overlap_cap=${policy.rules.none.maxPriorReportingChainOverlapRatio ?? "none"}; reporting_chain_carryover_budget=${policy.rules.none.reportingChainCarryoverBudget ?? "none"}; reporting_chain_carryover_lookback=${policy.rules.none.reportingChainCarryoverLookbackPromotions ?? "none"}; cohort_diversity=${policy.rules.none.requireRoleCohortDiversity}; min_cohorts=${policy.rules.none.minimumDistinctRoleCohorts ?? "none"}; team_diversity=${policy.rules.none.requireReviewerTeamDiversity}; min_teams=${policy.rules.none.minimumDistinctReviewerTeams ?? "none"}; reporting_chain_diversity=${policy.rules.none.requireReportingChainDiversity}; min_reporting_chains=${policy.rules.none.minimumDistinctReportingChains ?? "none"}; concentration_budget=${policy.rules.none.approvalConcentrationBudget ?? "none"}; concentration_preset=${policy.rules.none.approvalConcentrationPreset ?? "none"}; concentration_weights=${formatWeights(policy.rules.none.approvalConcentrationWeights)}`,
    )
    lines.push(
      `- allow_warn: approvals=${policy.rules.allow_warn.minimumApprovals}; role=${policy.rules.allow_warn.minimumRole ?? "none"}; distinct=${policy.rules.allow_warn.requireDistinctApprovers}; independent=${policy.rules.allow_warn.requireIndependentReviewer}; fresh=${policy.rules.allow_warn.requirePriorApproverExclusion}; overlap_cap=${policy.rules.allow_warn.maxPriorApproverOverlapRatio ?? "none"}; carryover_budget=${policy.rules.allow_warn.reviewerCarryoverBudget ?? "none"}; carryover_lookback=${policy.rules.allow_warn.reviewerCarryoverLookbackPromotions ?? "none"}; team_carryover_budget=${policy.rules.allow_warn.teamCarryoverBudget ?? "none"}; team_carryover_lookback=${policy.rules.allow_warn.teamCarryoverLookbackPromotions ?? "none"}; reporting_chain_overlap_cap=${policy.rules.allow_warn.maxPriorReportingChainOverlapRatio ?? "none"}; reporting_chain_carryover_budget=${policy.rules.allow_warn.reportingChainCarryoverBudget ?? "none"}; reporting_chain_carryover_lookback=${policy.rules.allow_warn.reportingChainCarryoverLookbackPromotions ?? "none"}; cohort_diversity=${policy.rules.allow_warn.requireRoleCohortDiversity}; min_cohorts=${policy.rules.allow_warn.minimumDistinctRoleCohorts ?? "none"}; team_diversity=${policy.rules.allow_warn.requireReviewerTeamDiversity}; min_teams=${policy.rules.allow_warn.minimumDistinctReviewerTeams ?? "none"}; reporting_chain_diversity=${policy.rules.allow_warn.requireReportingChainDiversity}; min_reporting_chains=${policy.rules.allow_warn.minimumDistinctReportingChains ?? "none"}; concentration_budget=${policy.rules.allow_warn.approvalConcentrationBudget ?? "none"}; concentration_preset=${policy.rules.allow_warn.approvalConcentrationPreset ?? "none"}; concentration_weights=${formatWeights(policy.rules.allow_warn.approvalConcentrationWeights)}`,
    )
    lines.push(
      `- force: approvals=${policy.rules.force.minimumApprovals}; role=${policy.rules.force.minimumRole ?? "none"}; distinct=${policy.rules.force.requireDistinctApprovers}; independent=${policy.rules.force.requireIndependentReviewer}; fresh=${policy.rules.force.requirePriorApproverExclusion}; overlap_cap=${policy.rules.force.maxPriorApproverOverlapRatio ?? "none"}; carryover_budget=${policy.rules.force.reviewerCarryoverBudget ?? "none"}; carryover_lookback=${policy.rules.force.reviewerCarryoverLookbackPromotions ?? "none"}; team_carryover_budget=${policy.rules.force.teamCarryoverBudget ?? "none"}; team_carryover_lookback=${policy.rules.force.teamCarryoverLookbackPromotions ?? "none"}; reporting_chain_overlap_cap=${policy.rules.force.maxPriorReportingChainOverlapRatio ?? "none"}; reporting_chain_carryover_budget=${policy.rules.force.reportingChainCarryoverBudget ?? "none"}; reporting_chain_carryover_lookback=${policy.rules.force.reportingChainCarryoverLookbackPromotions ?? "none"}; cohort_diversity=${policy.rules.force.requireRoleCohortDiversity}; min_cohorts=${policy.rules.force.minimumDistinctRoleCohorts ?? "none"}; team_diversity=${policy.rules.force.requireReviewerTeamDiversity}; min_teams=${policy.rules.force.minimumDistinctReviewerTeams ?? "none"}; reporting_chain_diversity=${policy.rules.force.requireReportingChainDiversity}; min_reporting_chains=${policy.rules.force.minimumDistinctReportingChains ?? "none"}; concentration_budget=${policy.rules.force.approvalConcentrationBudget ?? "none"}; concentration_preset=${policy.rules.force.approvalConcentrationPreset ?? "none"}; concentration_weights=${formatWeights(policy.rules.force.approvalConcentrationWeights)}`,
    )
    lines.push(
      `- reentry: approvals=${policy.rules.reentry.minimumApprovals}; role=${policy.rules.reentry.minimumRole ?? "none"}; distinct=${policy.rules.reentry.requireDistinctApprovers}; independent=${policy.rules.reentry.requireIndependentReviewer}; fresh=${policy.rules.reentry.requirePriorApproverExclusion}; overlap_cap=${policy.rules.reentry.maxPriorApproverOverlapRatio ?? "none"}; carryover_budget=${policy.rules.reentry.reviewerCarryoverBudget ?? "none"}; carryover_lookback=${policy.rules.reentry.reviewerCarryoverLookbackPromotions ?? "none"}; team_carryover_budget=${policy.rules.reentry.teamCarryoverBudget ?? "none"}; team_carryover_lookback=${policy.rules.reentry.teamCarryoverLookbackPromotions ?? "none"}; reporting_chain_overlap_cap=${policy.rules.reentry.maxPriorReportingChainOverlapRatio ?? "none"}; reporting_chain_carryover_budget=${policy.rules.reentry.reportingChainCarryoverBudget ?? "none"}; reporting_chain_carryover_lookback=${policy.rules.reentry.reportingChainCarryoverLookbackPromotions ?? "none"}; cohort_diversity=${policy.rules.reentry.requireRoleCohortDiversity}; min_cohorts=${policy.rules.reentry.minimumDistinctRoleCohorts ?? "none"}; team_diversity=${policy.rules.reentry.requireReviewerTeamDiversity}; min_teams=${policy.rules.reentry.minimumDistinctReviewerTeams ?? "none"}; reporting_chain_diversity=${policy.rules.reentry.requireReportingChainDiversity}; min_reporting_chains=${policy.rules.reentry.minimumDistinctReportingChains ?? "none"}; concentration_budget=${policy.rules.reentry.approvalConcentrationBudget ?? "none"}; concentration_preset=${policy.rules.reentry.approvalConcentrationPreset ?? "none"}; concentration_weights=${formatWeights(policy.rules.reentry.approvalConcentrationWeights)}`,
    )
  }

  export function renderStoredPolicy(record: PolicyRecord) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion approval policy record")
    lines.push("")
    lines.push(`- scope: ${record.scope}`)
    lines.push(`- project id: ${record.projectID ?? "n/a"}`)
    lines.push(`- updated at: ${record.updatedAt}`)
    pushPolicy(lines, record.policy)
    lines.push("")
    return lines.join("\n")
  }

  export function renderResolutionReport(resolution: Resolution) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion approval policy resolution")
    lines.push("")
    lines.push(`- source: ${resolution.source}`)
    lines.push(`- project id: ${resolution.projectID ?? "n/a"}`)
    lines.push(`- resolved at: ${resolution.resolvedAt}`)
    lines.push(`- persisted record: ${resolution.record ? "yes" : "no"}`)
    if (resolution.record) {
      lines.push(`- persisted scope: ${resolution.record.scope}`)
      lines.push(`- persisted updated at: ${resolution.record.updatedAt}`)
    }
    pushPolicy(lines, resolution.policy)
    lines.push("")
    return lines.join("\n")
  }
}
