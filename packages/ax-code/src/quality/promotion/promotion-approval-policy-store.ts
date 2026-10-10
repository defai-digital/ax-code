import z from "zod"
import { QualityPromotionApprovalPolicy } from "./promotion-approval-policy"
import { QualityScopedPolicyStore } from "./policy-store"

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

  const store = QualityScopedPolicyStore.create<PolicyRecord, QualityPromotionApprovalPolicy.Policy>({
    keyPrefix: "quality_model_approval_policy",
    scopeNoun: "approval policies",
    parseRecord: (raw) => PolicyRecord.parse(raw),
    buildRecord: (scope, projectID, policy) =>
      PolicyRecord.parse({
        schemaVersion: 1,
        kind: "ax-code-quality-promotion-approval-policy-record",
        scope,
        projectID,
        updatedAt: new Date().toISOString(),
        policy,
      }),
  })

  export const getGlobal = store.getGlobal
  export const getProject = store.getProject
  export const setGlobal = store.setGlobal
  export const setProject = store.setProject
  export const clearGlobal = store.clearGlobal
  export const clearProject = store.clearProject
  export const list = store.list

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
    const formatRule = (label: string, rule: QualityPromotionApprovalPolicy.Policy["rules"]["none"]) =>
      `- ${label}: approvals=${rule.minimumApprovals}; role=${rule.minimumRole ?? "none"}; distinct=${rule.requireDistinctApprovers}; independent=${rule.requireIndependentReviewer}; fresh=${rule.requirePriorApproverExclusion}; overlap_cap=${rule.maxPriorApproverOverlapRatio ?? "none"}; carryover_budget=${rule.reviewerCarryoverBudget ?? "none"}; carryover_lookback=${rule.reviewerCarryoverLookbackPromotions ?? "none"}; team_carryover_budget=${rule.teamCarryoverBudget ?? "none"}; team_carryover_lookback=${rule.teamCarryoverLookbackPromotions ?? "none"}; reporting_chain_overlap_cap=${rule.maxPriorReportingChainOverlapRatio ?? "none"}; reporting_chain_carryover_budget=${rule.reportingChainCarryoverBudget ?? "none"}; reporting_chain_carryover_lookback=${rule.reportingChainCarryoverLookbackPromotions ?? "none"}; cohort_diversity=${rule.requireRoleCohortDiversity}; min_cohorts=${rule.minimumDistinctRoleCohorts ?? "none"}; team_diversity=${rule.requireReviewerTeamDiversity}; min_teams=${rule.minimumDistinctReviewerTeams ?? "none"}; reporting_chain_diversity=${rule.requireReportingChainDiversity}; min_reporting_chains=${rule.minimumDistinctReportingChains ?? "none"}; concentration_budget=${rule.approvalConcentrationBudget ?? "none"}; concentration_preset=${rule.approvalConcentrationPreset ?? "none"}; concentration_weights=${formatWeights(rule.approvalConcentrationWeights)}`
    lines.push("")
    lines.push("Rules:")
    for (const key of ["none", "allow_warn", "force", "reentry"] as const) {
      lines.push(formatRule(key, policy.rules[key]))
    }
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
