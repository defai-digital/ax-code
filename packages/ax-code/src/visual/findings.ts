/**
 * Visual findings tracker (ADR-047).
 *
 * Tracks visual findings across repair iterations. Manages the
 * lifecycle from open → fixed/accepted/false-positive, links
 * findings to artifacts, and computes residual risk.
 */
import crypto from "crypto"
import type { VisualFinding, VisualFindingCategory, VisualFindingSeverity, VisualFindingStatus, VisualRun } from "./run"

export type FindingsSummary = {
  total: number
  open: number
  fixed: number
  accepted: number
  falsePositive: number
  bySeverity: Record<VisualFindingSeverity, number>
  byCategory: Record<string, number>
}

/**
 * Create a new visual finding with a generated ID.
 */
export function createFinding(input: {
  severity: VisualFindingSeverity
  category: VisualFindingCategory
  title: string
  evidenceArtifactIDs?: string[]
  suggestedFix?: string
}): VisualFinding {
  return {
    id: `finding_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
    severity: input.severity,
    category: input.category,
    title: input.title,
    evidenceArtifactIDs: input.evidenceArtifactIDs ?? [],
    suggestedFix: input.suggestedFix,
    status: "open",
  }
}

/**
 * Update a finding's status.
 */
export function updateFindingStatus(
  findings: VisualFinding[],
  findingID: string,
  status: VisualFindingStatus,
): VisualFinding[] {
  return findings.map((f) => (f.id === findingID ? { ...f, status } : f))
}

/**
 * Merge findings from a new run into the accumulated set.
 * Open findings that no longer appear in the new run are marked as fixed.
 * New findings are added. Fixed findings that reappear are reopened.
 */
export function mergeFindings(existing: VisualFinding[], incoming: VisualFinding[]): VisualFinding[] {
  const merged = [...existing]
  const incomingKeys = new Set(incoming.map((f) => `${f.title}::${f.category}`))

  // Mark existing open findings that don't appear in incoming as fixed
  for (let i = 0; i < merged.length; i++) {
    const f = merged[i]!
    if (f.status === "open" && !incomingKeys.has(`${f.title}::${f.category}`)) {
      merged[i] = { ...f, status: "fixed" }
    }
  }

  // Add new findings and reopen fixed findings that reappear.
  const existingByKey = new Map(merged.map((f, index) => [`${f.title}::${f.category}`, { finding: f, index }]))
  for (const f of incoming) {
    const existingEntry = existingByKey.get(`${f.title}::${f.category}`)
    if (!existingEntry) {
      merged.push(f)
      continue
    }
    if (existingEntry.finding.status === "fixed" && f.status === "open") {
      merged[existingEntry.index] = {
        ...f,
        id: existingEntry.finding.id,
        status: "open",
      }
    }
  }

  return merged
}

/**
 * Compute a summary of the current findings state.
 */
export function summarizeFindings(findings: VisualFinding[]): FindingsSummary {
  const summary: FindingsSummary = {
    total: findings.length,
    open: 0,
    fixed: 0,
    accepted: 0,
    falsePositive: 0,
    bySeverity: { info: 0, warning: 0, error: 0, critical: 0 },
    byCategory: {},
  }

  for (const f of findings) {
    switch (f.status) {
      case "open":
        summary.open++
        break
      case "fixed":
        summary.fixed++
        break
      case "accepted":
        summary.accepted++
        break
      case "false-positive":
        summary.falsePositive++
        break
    }
    summary.bySeverity[f.severity]++
    summary.byCategory[f.category] = (summary.byCategory[f.category] ?? 0) + 1
  }

  return summary
}

/**
 * Get all open findings sorted by severity (critical first).
 */
export function openFindings(findings: VisualFinding[]): VisualFinding[] {
  const severityOrder: Record<VisualFindingSeverity, number> = {
    critical: 0,
    error: 1,
    warning: 2,
    info: 3,
  }
  return findings
    .filter((f) => f.status === "open")
    .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
}

/**
 * Check whether all findings are resolved (fixed, accepted, or false-positive).
 */
export function allFindingsResolved(findings: VisualFinding[]): boolean {
  return findings.every((f) => f.status !== "open")
}
