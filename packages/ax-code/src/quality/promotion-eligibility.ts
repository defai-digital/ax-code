import z from "zod"
import { QualityCalibrationModel } from "./calibration-model"
import { QualityReentryContext } from "./reentry-context"
import { QualityReentryRemediation } from "./reentry-remediation"
import { QualityStabilityGuard } from "./stability-guard"

export namespace QualityPromotionEligibility {
  export const ReviewerCarryoverEntry = z.object({
    approver: z.string(),
    weightedReuseScore: z.number().positive(),
    appearances: z.number().int().positive(),
    mostRecentPromotionID: z.string(),
    mostRecentPromotedAt: z.string(),
  })
  export type ReviewerCarryoverEntry = z.output<typeof ReviewerCarryoverEntry>

  export const TeamCarryoverEntry = z.object({
    team: z.string(),
    weightedReuseScore: z.number().positive(),
    appearances: z.number().int().positive(),
    mostRecentPromotionID: z.string(),
    mostRecentPromotedAt: z.string(),
  })
  export type TeamCarryoverEntry = z.output<typeof TeamCarryoverEntry>

  export const ReportingChainCarryoverEntry = z.object({
    reportingChain: z.string(),
    weightedReuseScore: z.number().positive(),
    appearances: z.number().int().positive(),
    mostRecentPromotionID: z.string(),
    mostRecentPromotedAt: z.string(),
  })
  export type ReportingChainCarryoverEntry = z.output<typeof ReportingChainCarryoverEntry>

  export const EligibilityGate = z.object({
    name: z.string(),
    status: z.enum(["pass", "warn", "fail"]),
    detail: z.string(),
  })
  export type EligibilityGate = z.output<typeof EligibilityGate>

  export const EligibilitySummary = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-eligibility"),
    source: z.string(),
    evaluatedAt: z.string(),
    benchmarkStatus: z.enum(["pass", "warn", "fail"]),
    stabilityStatus: z.enum(["pass", "warn", "fail"]),
    decision: z.enum(["go", "review", "no_go"]),
    requiredOverride: z.enum(["none", "allow_warn", "force"]),
    currentActiveSource: z.string().nullable(),
    lastPromotionAt: z.string().nullable(),
    lastRollbackAt: z.string().nullable(),
    reentryContext: z
      .object({
        rollbackID: z.string(),
        promotionID: z.string(),
        rolledBackAt: z.string(),
        watchOverallStatus: z.enum(["pass", "warn", "fail"]),
        watchReleasePolicySource: z.enum(["explicit", "project", "global", "default"]).nullable(),
        watchReleasePolicyDigest: z.string().nullable(),
        sameReleasePolicyAsCurrent: z.boolean().nullable(),
        rollbackTargetSource: z.string().nullable(),
        priorPromotionApprovers: z.array(z.string()),
        teamCarryoverHistory: TeamCarryoverEntry.array(),
        priorPromotionReportingChains: z.array(z.string()),
        reviewerCarryoverHistory: ReviewerCarryoverEntry.array(),
        reportingChainCarryoverHistory: ReportingChainCarryoverEntry.array(),
      })
      .nullable(),
    remediation: z
      .object({
        remediationID: z.string(),
        contextID: z.string(),
        rollbackID: z.string(),
        createdAt: z.string(),
        author: z.string(),
        summary: z.string(),
        evidenceCount: z.number().int().positive(),
        currentReleasePolicyDigest: z.string().nullable(),
        matchesCurrentReleasePolicyDigest: z.boolean().nullable(),
      })
      .nullable(),
    history: z.object({
      priorPromotions: z.number().int().nonnegative(),
      priorRollbacks: z.number().int().nonnegative(),
      recentRollbackCount: z.number().int().nonnegative(),
      coolingWindowActive: z.boolean(),
      escalationRequired: z.boolean(),
    }),
    gates: EligibilityGate.array(),
  })
  export type EligibilitySummary = z.output<typeof EligibilitySummary>

  export function summarize(input: {
    bundle: QualityCalibrationModel.BenchmarkBundle
    stability: QualityStabilityGuard.StabilitySummary
    currentActiveSource?: string | null
    lastPromotionAt?: string | null
    lastRollbackAt?: string | null
    priorPromotions?: number
    priorRollbacks?: number
    reentryContext?: QualityReentryContext.ContextArtifact
    remediation?: QualityReentryRemediation.RemediationArtifact
    priorPromotionApprovers?: string[]
    teamCarryoverHistory?: TeamCarryoverEntry[]
    priorPromotionReportingChains?: string[]
    reviewerCarryoverHistory?: ReviewerCarryoverEntry[]
    reportingChainCarryoverHistory?: ReportingChainCarryoverEntry[]
    currentReleasePolicyDigest?: string | null
  }): EligibilitySummary {
    if (input.remediation && !input.reentryContext) {
      throw new Error(`Remediation ${input.remediation.remediationID} requires a reentry context`)
    }
    if (input.remediation && input.reentryContext) {
      if (input.remediation.source !== input.bundle.model.source) {
        throw new Error(`Remediation source mismatch: ${input.remediation.source} vs ${input.bundle.model.source}`)
      }
      if (input.remediation.contextID !== input.reentryContext.contextID) {
        throw new Error(
          `Remediation context mismatch: ${input.remediation.contextID} vs ${input.reentryContext.contextID}`,
        )
      }
      if (input.remediation.rollbackID !== input.reentryContext.rollbackID) {
        throw new Error(
          `Remediation rollback mismatch: ${input.remediation.rollbackID} vs ${input.reentryContext.rollbackID}`,
        )
      }
      if (input.remediation.createdAt < input.reentryContext.rolledBackAt) {
        throw new Error(
          `Remediation ${input.remediation.remediationID} predates rollback ${input.reentryContext.rollbackID}`,
        )
      }
    }

    const benchmarkStatus = input.bundle.comparison.overallStatus
    const stabilityStatus = input.stability.overallStatus
    const evaluatedAt = new Date().toISOString()
    const sameReleasePolicyAsCurrent =
      input.reentryContext?.watch.releasePolicyDigest && input.currentReleasePolicyDigest
        ? input.reentryContext.watch.releasePolicyDigest === input.currentReleasePolicyDigest
        : null
    const matchesCurrentReleasePolicyDigest =
      input.remediation?.currentReleasePolicyDigest && input.currentReleasePolicyDigest
        ? input.remediation.currentReleasePolicyDigest === input.currentReleasePolicyDigest
        : null
    const gates: EligibilityGate[] = [
      {
        name: "benchmark-comparison",
        status: benchmarkStatus,
        detail: `comparison status=${benchmarkStatus}; candidate=${input.bundle.comparison.candidateSource}; baseline=${input.bundle.comparison.baselineSource}`,
      },
      ...input.stability.gates.map((gate) => ({
        name: `stability:${gate.name}`,
        status: gate.status,
        detail: gate.detail,
      })),
    ]
    if (input.reentryContext && !input.remediation && !input.stability.coolingWindowActive) {
      gates.push({
        name: "reentry:missing-remediation",
        status: "warn",
        detail:
          `latest rollback=${input.reentryContext.rolledBackAt}; ` +
          `no remediation artifact recorded for context ${input.reentryContext.contextID}`,
      })
    }
    if (input.reentryContext && sameReleasePolicyAsCurrent === true && !input.stability.coolingWindowActive) {
      gates.push({
        name: "reentry:same-release-policy",
        status: "warn",
        detail:
          `latest rollback=${input.reentryContext.rolledBackAt}; ` +
          `release policy digest unchanged (${input.reentryContext.watch.releasePolicyDigest}); ` +
          (input.remediation
            ? `remediation=${input.remediation.remediationID}; author=${input.remediation.author}; createdAt=${input.remediation.createdAt}`
            : "no remediation artifact recorded"),
      })
    }

    const decision = gates.some((gate) => gate.status === "fail")
      ? "no_go"
      : gates.some((gate) => gate.status === "warn")
        ? "review"
        : "go"
    const requiredOverride = decision === "no_go" ? "force" : decision === "review" ? "allow_warn" : "none"

    return {
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-eligibility",
      source: input.bundle.model.source,
      evaluatedAt,
      benchmarkStatus,
      stabilityStatus,
      decision,
      requiredOverride,
      currentActiveSource: input.currentActiveSource ?? null,
      lastPromotionAt: input.lastPromotionAt ?? null,
      lastRollbackAt: input.lastRollbackAt ?? null,
      reentryContext: input.reentryContext
        ? {
            rollbackID: input.reentryContext.rollbackID,
            promotionID: input.reentryContext.promotionID,
            rolledBackAt: input.reentryContext.rolledBackAt,
            watchOverallStatus: input.reentryContext.watch.overallStatus,
            watchReleasePolicySource: input.reentryContext.watch.releasePolicySource,
            watchReleasePolicyDigest: input.reentryContext.watch.releasePolicyDigest,
            sameReleasePolicyAsCurrent,
            rollbackTargetSource: input.reentryContext.rollbackTargetSource,
            priorPromotionApprovers: [...new Set(input.priorPromotionApprovers ?? [])].sort(),
            teamCarryoverHistory: [...(input.teamCarryoverHistory ?? [])].sort((a, b) => {
              const byScore = b.weightedReuseScore - a.weightedReuseScore
              if (byScore !== 0) return byScore
              return a.team.localeCompare(b.team)
            }),
            priorPromotionReportingChains: [...new Set(input.priorPromotionReportingChains ?? [])].sort(),
            reviewerCarryoverHistory: [...(input.reviewerCarryoverHistory ?? [])].sort((a, b) => {
              const byScore = b.weightedReuseScore - a.weightedReuseScore
              if (byScore !== 0) return byScore
              return a.approver.localeCompare(b.approver)
            }),
            reportingChainCarryoverHistory: [...(input.reportingChainCarryoverHistory ?? [])].sort((a, b) => {
              const byScore = b.weightedReuseScore - a.weightedReuseScore
              if (byScore !== 0) return byScore
              return a.reportingChain.localeCompare(b.reportingChain)
            }),
          }
        : null,
      remediation: input.remediation
        ? {
            remediationID: input.remediation.remediationID,
            contextID: input.remediation.contextID,
            rollbackID: input.remediation.rollbackID,
            createdAt: input.remediation.createdAt,
            author: input.remediation.author,
            summary: input.remediation.summary,
            evidenceCount: input.remediation.evidence.length,
            currentReleasePolicyDigest: input.remediation.currentReleasePolicyDigest,
            matchesCurrentReleasePolicyDigest,
          }
        : null,
      history: {
        priorPromotions: input.priorPromotions ?? 0,
        priorRollbacks: input.priorRollbacks ?? 0,
        recentRollbackCount: input.stability.recentRollbackCount,
        coolingWindowActive: input.stability.coolingWindowActive,
        escalationRequired: input.stability.escalationRequired,
      },
      gates,
    }
  }

  export function blockingReason(summary: EligibilitySummary) {
    const failGate = summary.gates.find((gate) => gate.status === "fail")
    if (!failGate) return
    if (failGate.name === "benchmark-comparison") {
      return `comparison status is fail`
    }
    if (failGate.name === "stability:cooling-window") {
      return `cooling window active (${failGate.detail})`
    }
    return `${failGate.name}: ${failGate.detail}`
  }

  export function reviewReason(summary: EligibilitySummary) {
    const warnGates = summary.gates.filter((gate) => gate.status === "warn")
    if (warnGates.length === 0) return
    return warnGates.map((gate) => `${gate.name}: ${gate.detail}`).join("; ")
  }

  export function renderReport(summary: EligibilitySummary) {
    const reentryContext = summary.reentryContext
    const lines: string[] = []
    lines.push("## ax-code quality promotion eligibility")
    lines.push("")
    lines.push(`- source: ${summary.source}`)
    lines.push(`- evaluated at: ${summary.evaluatedAt}`)
    lines.push(`- benchmark status: ${summary.benchmarkStatus}`)
    lines.push(`- stability status: ${summary.stabilityStatus}`)
    lines.push(`- decision: ${summary.decision}`)
    lines.push(`- required override: ${summary.requiredOverride}`)
    lines.push(`- current active source: ${summary.currentActiveSource ?? "none"}`)
    lines.push(`- last promotion at: ${summary.lastPromotionAt ?? "n/a"}`)
    lines.push(`- last rollback at: ${summary.lastRollbackAt ?? "n/a"}`)
    lines.push(`- reentry context rollback id: ${summary.reentryContext?.rollbackID ?? "n/a"}`)
    lines.push(`- reentry promotion id: ${summary.reentryContext?.promotionID ?? "n/a"}`)
    lines.push(`- reentry policy digest: ${summary.reentryContext?.watchReleasePolicyDigest ?? "n/a"}`)
    lines.push(`- same release policy as current: ${summary.reentryContext?.sameReleasePolicyAsCurrent ?? "n/a"}`)
    lines.push(`- prior promotion approvers: ${(reentryContext?.priorPromotionApprovers ?? []).join(", ") || "n/a"}`)
    lines.push(
      `- team carryover history: ${(reentryContext?.teamCarryoverHistory ?? [])
        .map((entry) => `${entry.team}:${entry.weightedReuseScore.toFixed(2)}`)
        .join(", ") || "n/a"}`,
    )
    lines.push(
      `- prior promotion reporting chains: ${(reentryContext?.priorPromotionReportingChains ?? []).join(", ") || "n/a"}`,
    )
    lines.push(
      `- reviewer carryover history: ${(reentryContext?.reviewerCarryoverHistory ?? [])
        .map((entry) => `${entry.approver}:${entry.weightedReuseScore.toFixed(2)}`)
        .join(", ") || "n/a"}`,
    )
    lines.push(
      `- reporting chain carryover history: ${(reentryContext?.reportingChainCarryoverHistory ?? [])
        .map((entry) => `${entry.reportingChain}:${entry.weightedReuseScore.toFixed(2)}`)
        .join(", ") || "n/a"}`,
    )
    lines.push(`- remediation id: ${summary.remediation?.remediationID ?? "n/a"}`)
    lines.push(`- remediation author: ${summary.remediation?.author ?? "n/a"}`)
    lines.push(`- remediation evidence count: ${summary.remediation?.evidenceCount ?? "n/a"}`)
    lines.push(`- remediation policy digest: ${summary.remediation?.currentReleasePolicyDigest ?? "n/a"}`)
    lines.push(
      `- remediation matches current policy: ${summary.remediation?.matchesCurrentReleasePolicyDigest ?? "n/a"}`,
    )
    lines.push(`- prior promotions: ${summary.history.priorPromotions}`)
    lines.push(`- prior rollbacks: ${summary.history.priorRollbacks}`)
    lines.push(`- recent rollback count: ${summary.history.recentRollbackCount}`)
    lines.push(`- cooling window active: ${summary.history.coolingWindowActive}`)
    lines.push(`- escalation required: ${summary.history.escalationRequired}`)
    lines.push("")
    lines.push("Gates:")
    for (const gate of summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }
}
