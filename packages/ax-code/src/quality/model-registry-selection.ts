import type { QualityPromotionEligibility } from "./promotion-eligibility"

export type RegistryModelRecord = {
  registeredAt: string
  model: {
    source: string
  }
}

export type RegistryApproval = {
  approver: string
  team?: string | null
  reportingChain?: string | null
}

export type RegistryPromotionRecord = {
  promotionID: string
  source: string
  promotedAt: string
  approval?: RegistryApproval
  approvals?: RegistryApproval[]
  eligibility?: {
    reentryContext?: unknown | null
  }
}

export type RegistryRollbackRecord = {
  source: string
  rolledBackAt: string
}

export function normalizeRegistryReportingChain(reportingChain: string | null | undefined) {
  const normalized = reportingChain?.trim().toLowerCase()
  return normalized ? normalized : null
}

export function normalizeRegistryTeam(team: string | null | undefined) {
  const normalized = team?.trim().toLowerCase()
  return normalized ? normalized : null
}

export function sortModelRecords<T extends RegistryModelRecord>(records: readonly T[]) {
  return [...records].sort((a, b) => {
    const byRegisteredAt = a.registeredAt.localeCompare(b.registeredAt)
    if (byRegisteredAt !== 0) return byRegisteredAt
    return a.model.source.localeCompare(b.model.source)
  })
}

export function sortPromotionRecords<T extends RegistryPromotionRecord>(records: readonly T[]) {
  return [...records].sort((a, b) => a.promotedAt.localeCompare(b.promotedAt) || a.source.localeCompare(b.source))
}

export function sortRollbackRecords<T extends RegistryRollbackRecord>(records: readonly T[]) {
  return [...records].sort((a, b) => a.rolledBackAt.localeCompare(b.rolledBackAt) || a.source.localeCompare(b.source))
}

function uniqueSorted(values: Iterable<string>) {
  return [...new Set(values)].sort()
}

function approvalList(promotion: RegistryPromotionRecord) {
  return [...(promotion.approvals ?? []), ...(promotion.approval ? [promotion.approval] : [])]
}

export function promotionApprovers(promotion: RegistryPromotionRecord) {
  return uniqueSorted(approvalList(promotion).map((approval) => approval.approver))
}

export function promotionTeams(promotion: RegistryPromotionRecord) {
  return uniqueSorted(
    approvalList(promotion)
      .map((approval) => normalizeRegistryTeam(approval.team))
      .filter((value): value is string => value !== null),
  )
}

export function promotionReportingChains(promotion: RegistryPromotionRecord) {
  return uniqueSorted(
    approvalList(promotion)
      .map((approval) => normalizeRegistryReportingChain(approval.reportingChain))
      .filter((value): value is string => value !== null),
  )
}

function reentryPromotions<T extends RegistryPromotionRecord>(promotions: readonly T[], lookbackPromotions: number) {
  return promotions
    .filter((promotion) => promotion.eligibility?.reentryContext)
    .slice(-lookbackPromotions)
    .reverse()
}

export function reviewerCarryoverHistory<T extends RegistryPromotionRecord>(
  promotions: readonly T[],
  lookbackPromotions: number,
) {
  const history = reentryPromotions(promotions, lookbackPromotions).reduce((map, promotion, index) => {
    const weight = 1 / 2 ** index
    for (const approver of promotionApprovers(promotion)) {
      const existing = map.get(approver)
      if (existing) {
        existing.weightedReuseScore += weight
        existing.appearances += 1
        continue
      }
      map.set(approver, {
        approver,
        weightedReuseScore: weight,
        appearances: 1,
        mostRecentPromotionID: promotion.promotionID,
        mostRecentPromotedAt: promotion.promotedAt,
      })
    }
    return map
  }, new Map<string, QualityPromotionEligibility.ReviewerCarryoverEntry>())
  return [...history.values()].sort((a, b) => {
    const byScore = b.weightedReuseScore - a.weightedReuseScore
    if (byScore !== 0) return byScore
    return a.approver.localeCompare(b.approver)
  })
}

export function teamCarryoverHistory<T extends RegistryPromotionRecord>(
  promotions: readonly T[],
  lookbackPromotions: number,
) {
  const history = reentryPromotions(promotions, lookbackPromotions).reduce((map, promotion, index) => {
    const weight = 1 / 2 ** index
    for (const team of promotionTeams(promotion)) {
      const existing = map.get(team)
      if (existing) {
        existing.weightedReuseScore += weight
        existing.appearances += 1
        continue
      }
      map.set(team, {
        team,
        weightedReuseScore: weight,
        appearances: 1,
        mostRecentPromotionID: promotion.promotionID,
        mostRecentPromotedAt: promotion.promotedAt,
      })
    }
    return map
  }, new Map<string, QualityPromotionEligibility.TeamCarryoverEntry>())
  return [...history.values()].sort((a, b) => {
    const byScore = b.weightedReuseScore - a.weightedReuseScore
    if (byScore !== 0) return byScore
    return a.team.localeCompare(b.team)
  })
}

export function reportingChainCarryoverHistory<T extends RegistryPromotionRecord>(
  promotions: readonly T[],
  lookbackPromotions: number,
) {
  const history = reentryPromotions(promotions, lookbackPromotions).reduce((map, promotion, index) => {
    const weight = 1 / 2 ** index
    for (const reportingChain of promotionReportingChains(promotion)) {
      const existing = map.get(reportingChain)
      if (existing) {
        existing.weightedReuseScore += weight
        existing.appearances += 1
        continue
      }
      map.set(reportingChain, {
        reportingChain,
        weightedReuseScore: weight,
        appearances: 1,
        mostRecentPromotionID: promotion.promotionID,
        mostRecentPromotedAt: promotion.promotedAt,
      })
    }
    return map
  }, new Map<string, QualityPromotionEligibility.ReportingChainCarryoverEntry>())
  return [...history.values()].sort((a, b) => {
    const byScore = b.weightedReuseScore - a.weightedReuseScore
    if (byScore !== 0) return byScore
    return a.reportingChain.localeCompare(b.reportingChain)
  })
}
