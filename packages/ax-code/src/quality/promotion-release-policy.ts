import { createHash } from "crypto"
import z from "zod"
import { QualityPromotionApprovalPolicy } from "./promotion-approval-policy"
import { QualityStabilityGuard } from "./stability-guard"

export namespace QualityPromotionReleasePolicy {
  export const StabilityPolicy = z.object({
    cooldownHours: z.number().nonnegative(),
    repeatFailureWindowHours: z.number().positive(),
    repeatFailureThreshold: z.number().int().positive(),
  })
  export type StabilityPolicy = z.output<typeof StabilityPolicy>

  export const WatchPolicy = z.object({
    minRecords: z.number().int().positive(),
    maxRecords: z.number().int().positive().nullable(),
    abstentionWarnRate: z.number().min(0).max(1),
    abstentionFailRate: z.number().min(0).max(1),
    avgConfidenceWarnAbsDelta: z.number().min(0),
    avgConfidenceFailAbsDelta: z.number().min(0),
    maxConfidenceWarnAbsDelta: z.number().min(0),
    requireCandidateCoverage: z.boolean(),
  })
  export type WatchPolicy = z.output<typeof WatchPolicy>

  export const Policy = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-release-policy"),
    stability: StabilityPolicy,
    watch: WatchPolicy,
    approval: z.lazy(() => QualityPromotionApprovalPolicy.Policy),
  })
  export type Policy = z.output<typeof Policy>

  export const PolicyProvenance = z.object({
    policySource: z.enum(["explicit", "project", "global", "default"]),
    policyProjectID: z.string().nullable(),
    compatibilityApprovalSource: z.enum(["project", "global", "default"]).nullable(),
    resolvedAt: z.string(),
    persistedScope: z.enum(["global", "project"]).nullable(),
    persistedUpdatedAt: z.string().nullable(),
    digest: z.string(),
  })
  export type PolicyProvenance = z.output<typeof PolicyProvenance>

  export type PolicyOverrides = {
    stability?: Partial<StabilityPolicy>
    watch?: Partial<WatchPolicy>
    approval?: QualityPromotionApprovalPolicy.PolicyOverrides
  }

  export const DEFAULT_WATCH_MIN_RECORDS = 20
  export const DEFAULT_WATCH_MAX_RECORDS = null
  export const DEFAULT_ABSTENTION_WARN_RATE = 0.15
  export const DEFAULT_ABSTENTION_FAIL_RATE = 0.35
  export const DEFAULT_AVG_CONFIDENCE_WARN_ABS_DELTA = 0.15
  export const DEFAULT_AVG_CONFIDENCE_FAIL_ABS_DELTA = 0.3
  export const DEFAULT_MAX_CONFIDENCE_WARN_ABS_DELTA = 0.6

  export function merge(base: Policy, overrides?: PolicyOverrides): Policy {
    return Policy.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-release-policy",
      stability: {
        ...base.stability,
        ...overrides?.stability,
      },
      watch: {
        ...base.watch,
        ...overrides?.watch,
      },
      approval: overrides?.approval ? QualityPromotionApprovalPolicy.merge(base.approval, overrides.approval) : base.approval,
    })
  }

  export function defaults(input?: PolicyOverrides): Policy {
    return merge({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-release-policy",
      stability: {
        cooldownHours: QualityStabilityGuard.DEFAULT_COOLDOWN_HOURS,
        repeatFailureWindowHours: QualityStabilityGuard.DEFAULT_REPEAT_FAILURE_WINDOW_HOURS,
        repeatFailureThreshold: QualityStabilityGuard.DEFAULT_REPEAT_FAILURE_THRESHOLD,
      },
      watch: {
        minRecords: DEFAULT_WATCH_MIN_RECORDS,
        maxRecords: DEFAULT_WATCH_MAX_RECORDS,
        abstentionWarnRate: DEFAULT_ABSTENTION_WARN_RATE,
        abstentionFailRate: DEFAULT_ABSTENTION_FAIL_RATE,
        avgConfidenceWarnAbsDelta: DEFAULT_AVG_CONFIDENCE_WARN_ABS_DELTA,
        avgConfidenceFailAbsDelta: DEFAULT_AVG_CONFIDENCE_FAIL_ABS_DELTA,
        maxConfidenceWarnAbsDelta: DEFAULT_MAX_CONFIDENCE_WARN_ABS_DELTA,
        requireCandidateCoverage: true,
      },
      approval: QualityPromotionApprovalPolicy.defaults(),
    }, input)
  }

  export function digest(policy: Policy) {
    return createHash("sha256").update(JSON.stringify(policy)).digest("hex")
  }

  export function renderReport(policy: Policy) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion release policy")
    lines.push("")
    lines.push("Stability:")
    lines.push(`- cooldown hours: ${policy.stability.cooldownHours}`)
    lines.push(`- repeat failure window hours: ${policy.stability.repeatFailureWindowHours}`)
    lines.push(`- repeat failure threshold: ${policy.stability.repeatFailureThreshold}`)
    lines.push("")
    lines.push("Watch:")
    lines.push(`- min records: ${policy.watch.minRecords}`)
    lines.push(`- max records: ${policy.watch.maxRecords ?? "none"}`)
    lines.push(`- abstention warn rate: ${policy.watch.abstentionWarnRate}`)
    lines.push(`- abstention fail rate: ${policy.watch.abstentionFailRate}`)
    lines.push(`- avg confidence warn abs delta: ${policy.watch.avgConfidenceWarnAbsDelta}`)
    lines.push(`- avg confidence fail abs delta: ${policy.watch.avgConfidenceFailAbsDelta}`)
    lines.push(`- max confidence warn abs delta: ${policy.watch.maxConfidenceWarnAbsDelta}`)
    lines.push(`- require candidate coverage: ${policy.watch.requireCandidateCoverage}`)
    lines.push("")
    lines.push("Approval:")
    lines.push(`- none approvals: ${policy.approval.rules.none.minimumApprovals}`)
    lines.push(`- allow_warn approvals: ${policy.approval.rules.allow_warn.minimumApprovals}`)
    lines.push(`- allow_warn min role: ${policy.approval.rules.allow_warn.minimumRole ?? "none"}`)
    lines.push(`- force approvals: ${policy.approval.rules.force.minimumApprovals}`)
    lines.push(`- force min role: ${policy.approval.rules.force.minimumRole ?? "none"}`)
    lines.push(`- reentry approvals: ${policy.approval.rules.reentry.minimumApprovals}`)
    lines.push(`- reentry min role: ${policy.approval.rules.reentry.minimumRole ?? "none"}`)
    lines.push(`- reentry independent reviewer: ${policy.approval.rules.reentry.requireIndependentReviewer}`)
    lines.push(`- reentry prior approver exclusion: ${policy.approval.rules.reentry.requirePriorApproverExclusion}`)
    lines.push(`- reentry max prior overlap ratio: ${policy.approval.rules.reentry.maxPriorApproverOverlapRatio ?? "none"}`)
    lines.push(`- reentry reviewer carryover budget: ${policy.approval.rules.reentry.reviewerCarryoverBudget ?? "none"}`)
    lines.push(`- reentry reviewer carryover lookback promotions: ${policy.approval.rules.reentry.reviewerCarryoverLookbackPromotions ?? "none"}`)
    lines.push(`- reentry team carryover budget: ${policy.approval.rules.reentry.teamCarryoverBudget ?? "none"}`)
    lines.push(`- reentry team carryover lookback promotions: ${policy.approval.rules.reentry.teamCarryoverLookbackPromotions ?? "none"}`)
    lines.push(`- reentry max prior reporting chain overlap ratio: ${policy.approval.rules.reentry.maxPriorReportingChainOverlapRatio ?? "none"}`)
    lines.push(`- reentry reporting chain carryover budget: ${policy.approval.rules.reentry.reportingChainCarryoverBudget ?? "none"}`)
    lines.push(`- reentry reporting chain carryover lookback promotions: ${policy.approval.rules.reentry.reportingChainCarryoverLookbackPromotions ?? "none"}`)
    lines.push(`- reentry role cohort diversity: ${policy.approval.rules.reentry.requireRoleCohortDiversity}`)
    lines.push(`- reentry minimum distinct role cohorts: ${policy.approval.rules.reentry.minimumDistinctRoleCohorts ?? "none"}`)
    lines.push(`- reentry reviewer team diversity: ${policy.approval.rules.reentry.requireReviewerTeamDiversity}`)
    lines.push(`- reentry minimum distinct reviewer teams: ${policy.approval.rules.reentry.minimumDistinctReviewerTeams ?? "none"}`)
    lines.push(`- reentry reporting chain diversity: ${policy.approval.rules.reentry.requireReportingChainDiversity}`)
    lines.push(`- reentry minimum distinct reporting chains: ${policy.approval.rules.reentry.minimumDistinctReportingChains ?? "none"}`)
    lines.push(`- reentry approval concentration budget: ${policy.approval.rules.reentry.approvalConcentrationBudget ?? "none"}`)
    lines.push(`- reentry approval concentration preset: ${policy.approval.rules.reentry.approvalConcentrationPreset ?? "none"}`)
    lines.push(`- reentry approval concentration weights: approver=${policy.approval.rules.reentry.approvalConcentrationWeights.approver}, team=${policy.approval.rules.reentry.approvalConcentrationWeights.team}, reporting_chain=${policy.approval.rules.reentry.approvalConcentrationWeights.reportingChain}`)
    lines.push("")
    return lines.join("\n")
  }
}
