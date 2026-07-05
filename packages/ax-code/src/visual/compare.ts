/**
 * Visual compare: before/after artifact comparison (ADR-047).
 *
 * Compares two visual runs (before and after) to determine which
 * findings were resolved, which persist, and which are new.
 * Used by the repair loop to verify fixes and detect regressions.
 */
import type { VisualArtifact, VisualFinding, VisualFindingStatus, VisualRun } from "./run"

export type CompareMatch = {
  url: string
  viewport: { width: number; height: number }
  beforeArtifacts: VisualArtifact[]
  afterArtifacts: VisualArtifact[]
}

export type CompareDelta = {
  resolved: VisualFinding[]
  persistent: VisualFinding[]
  introduced: VisualFinding[]
  statusTransitions: { findingID: string; from: VisualFindingStatus; to: VisualFindingStatus }[]
}

export type CompareResult = {
  beforeRunID: string
  afterRunID: string
  matches: CompareMatch[]
  delta: CompareDelta
  unresolvedCount: number
  resolvedCount: number
  introducedCount: number
}

/**
 * Match artifacts from two runs by URL + viewport label.
 */
function matchArtifacts(before: VisualRun, after: VisualRun): CompareMatch[] {
  const matches: CompareMatch[] = []
  const url =
    before.target.type === "url" ? before.target.url : after.target.type === "url" ? after.target.url : undefined

  if (!url) return matches

  // Group screenshots by label (which encodes viewport, e.g. "viewport-desktop")
  const beforeScreens = before.artifacts.filter((a) => a.kind === "screenshot")
  const afterScreens = after.artifacts.filter((a) => a.kind === "screenshot")

  const beforeByLabel = new Map<string, VisualArtifact[]>()
  for (const a of beforeScreens) {
    const list = beforeByLabel.get(a.label) ?? []
    list.push(a)
    beforeByLabel.set(a.label, list)
  }

  const afterByLabel = new Map<string, VisualArtifact[]>()
  for (const a of afterScreens) {
    const list = afterByLabel.get(a.label) ?? []
    list.push(a)
    afterByLabel.set(a.label, list)
  }

  // Match by label
  for (const [label, beforeArts] of beforeByLabel) {
    const afterArts = afterByLabel.get(label)
    if (afterArts) {
      // Extract viewport from label (e.g. "viewport-1440x900" or "viewport-desktop")
      const viewportMatch = label.match(/(\d+)x(\d+)/)
      const viewport = viewportMatch
        ? { width: parseInt(viewportMatch[1]!, 10), height: parseInt(viewportMatch[2]!, 10) }
        : { width: 0, height: 0 }

      matches.push({
        url,
        viewport,
        beforeArtifacts: beforeArts,
        afterArtifacts: afterArts,
      })
    }
  }

  return matches
}

/**
 * Compare findings between two visual runs to determine what changed.
 *
 * - A finding is "resolved" if the before-run has it open and the after-run
 *   does not contain a matching finding (by title + category).
 * - A finding is "persistent" if both runs contain it.
 * - A finding is "introduced" if only the after-run contains it.
 */
export function compareVisualRuns(before: VisualRun, after: VisualRun): CompareResult {
  const matches = matchArtifacts(before, after)

  const beforeFindings = before.findings.filter((f) => f.status === "open")
  const afterFindings = after.findings

  const resolved: VisualFinding[] = []
  const persistent: VisualFinding[] = []
  const introduced: VisualFinding[] = []
  const statusTransitions: CompareDelta["statusTransitions"] = []

  // Check each before finding against after findings
  for (const bf of beforeFindings) {
    const match = afterFindings.find((af) => af.title === bf.title && af.category === bf.category)
    if (match) {
      if (match.status === "fixed") {
        resolved.push(bf)
        statusTransitions.push({ findingID: bf.id, from: "open", to: "fixed" })
      } else {
        persistent.push(bf)
      }
    } else {
      // Not found in after — assume resolved
      resolved.push(bf)
      statusTransitions.push({ findingID: bf.id, from: "open", to: "fixed" })
    }
  }

  // Check for new findings in after that weren't in before
  for (const af of afterFindings) {
    const existed = beforeFindings.find((bf) => bf.title === af.title && bf.category === af.category)
    if (!existed) {
      introduced.push(af)
    }
  }

  return {
    beforeRunID: before.id,
    afterRunID: after.id,
    matches,
    delta: { resolved, persistent, introduced, statusTransitions },
    unresolvedCount: persistent.length,
    resolvedCount: resolved.length,
    introducedCount: introduced.length,
  }
}

/**
 * Format a compare result as a human-readable summary.
 */
export function formatCompareSummary(result: CompareResult): string {
  const lines: string[] = []
  lines.push(`## Visual Compare: ${result.beforeRunID} → ${result.afterRunID}`)
  lines.push("")
  lines.push(`- Resolved: ${result.resolvedCount}`)
  lines.push(`- Unresolved: ${result.unresolvedCount}`)
  lines.push(`- Introduced: ${result.introducedCount}`)
  lines.push(`- Viewport matches: ${result.matches.length}`)

  if (result.delta.resolved.length > 0) {
    lines.push("")
    lines.push("### Resolved Findings")
    for (const f of result.delta.resolved) {
      lines.push(`- [${f.severity}] ${f.title} (${f.category})`)
    }
  }

  if (result.delta.persistent.length > 0) {
    lines.push("")
    lines.push("### Persistent Findings")
    for (const f of result.delta.persistent) {
      lines.push(`- [${f.severity}] ${f.title} (${f.category})`)
    }
  }

  if (result.delta.introduced.length > 0) {
    lines.push("")
    lines.push("### Introduced Findings")
    for (const f of result.delta.introduced) {
      lines.push(`- [${f.severity}] ${f.title} (${f.category})`)
    }
  }

  return lines.join("\n")
}
