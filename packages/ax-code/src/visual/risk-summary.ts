/**
 * Residual risk summary (ADR-047).
 *
 * After one or more repair iterations, computes a residual risk
 * summary that describes what remains unfixed and the overall
 * confidence level of the visual review.
 */
import type { VisualFinding, VisualFindingSeverity } from "./run"
import { summarizeFindings, openFindings, type FindingsSummary } from "./findings"

export type ResidualRiskLevel = "none" | "low" | "medium" | "high" | "critical"

export type ResidualRiskReport = {
  level: ResidualRiskLevel
  openCount: number
  criticalCount: number
  errorCount: number
  warningCount: number
  infoCount: number
  summary: FindingsSummary
  openDetails: VisualFinding[]
  recommendation: string
}

/**
 * Compute the residual risk level from open findings.
 */
export function computeRiskLevel(openFindings: VisualFinding[]): ResidualRiskLevel {
  if (openFindings.length === 0) return "none"

  const hasCritical = openFindings.some((f) => f.severity === "critical")
  const hasError = openFindings.some((f) => f.severity === "error")
  const errorCount = openFindings.filter((f) => f.severity === "error").length
  const warningCount = openFindings.filter((f) => f.severity === "warning").length

  if (hasCritical) return "critical"
  if (errorCount >= 3) return "high"
  if (hasError) return "medium"
  if (warningCount >= 5) return "medium"
  return "low"
}

/**
 * Generate a risk recommendation based on the residual risk level.
 */
function riskRecommendation(level: ResidualRiskLevel, openDetails: VisualFinding[]): string {
  switch (level) {
    case "none":
      return "All findings resolved. Visual review passed."
    case "low":
      return "Minor findings remain. Consider addressing in a follow-up."
    case "medium":
      return "Significant findings remain. Manual review recommended before shipping."
    case "high":
      return "Multiple errors remain. Block shipping until resolved or explicitly accepted."
    case "critical":
      return "Critical issues remain. Must be resolved before shipping."
  }
}

/**
 * Compute the full residual risk report for a set of findings.
 */
export function computeResidualRisk(findings: VisualFinding[]): ResidualRiskReport {
  const summary = summarizeFindings(findings)
  const open = openFindings(findings)
  const level = computeRiskLevel(open)

  return {
    level,
    openCount: open.length,
    criticalCount: open.filter((f) => f.severity === "critical").length,
    errorCount: open.filter((f) => f.severity === "error").length,
    warningCount: open.filter((f) => f.severity === "warning").length,
    infoCount: open.filter((f) => f.severity === "info").length,
    summary,
    openDetails: open,
    recommendation: riskRecommendation(level, open),
  }
}

/**
 * Format a residual risk report as a text summary.
 */
export function formatResidualRisk(report: ResidualRiskReport): string {
  const lines: string[] = []
  lines.push(`## Residual Risk: ${report.level.toUpperCase()}`)
  lines.push("")
  lines.push(`Open findings: ${report.openCount}`)
  if (report.criticalCount > 0) lines.push(`  Critical: ${report.criticalCount}`)
  if (report.errorCount > 0) lines.push(`  Error: ${report.errorCount}`)
  if (report.warningCount > 0) lines.push(`  Warning: ${report.warningCount}`)
  if (report.infoCount > 0) lines.push(`  Info: ${report.infoCount}`)
  lines.push("")
  lines.push(
    `Fixed: ${report.summary.fixed} | Accepted: ${report.summary.accepted} | False positives: ${report.summary.falsePositive}`,
  )
  lines.push("")
  lines.push(`**Recommendation:** ${report.recommendation}`)

  if (report.openDetails.length > 0) {
    lines.push("")
    lines.push("### Open Findings")
    for (const f of report.openDetails) {
      const fix = f.suggestedFix ? ` — fix: ${f.suggestedFix}` : ""
      lines.push(`- [${f.severity}] **${f.title}** (${f.category})${fix}`)
    }
  }

  return lines.join("\n")
}
