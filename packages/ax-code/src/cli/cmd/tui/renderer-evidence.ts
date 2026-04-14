import { decideTuiRenderer, type TuiRendererDecision, type TuiRendererIssueLayer } from "./renderer-decision"

export type TuiRendererEvidenceStatus = "open" | "needs-repro" | "mitigated" | "closed"

export type TuiRendererEvidenceSource =
  | "bug-report"
  | "benchmark"
  | "manual-repro"
  | "release-regression"
  | "support-case"
  | "code-audit"

export type TuiRendererIssueEvidence = {
  id: string
  title: string
  layer: TuiRendererIssueLayer
  status: TuiRendererEvidenceStatus
  reproducible: boolean
  source: TuiRendererEvidenceSource
  criteriaFailures?: string[]
  blocksProductDirection?: boolean
  notes?: string[]
}

export type TuiRendererEvidenceInput = {
  issues: TuiRendererIssueEvidence[]
  installOrBuildRiskAccepted?: boolean
  offlinePackagingDeterministic?: boolean
}

export type TuiRendererEvidenceSummary = {
  total: number
  active: number
  reproducible: number
  rendererSpecific: number
  needsRepro: string[]
  criteriaFailures: string[]
  byLayer: Record<TuiRendererIssueLayer, number>
  decision: TuiRendererDecision
}

function isActive(issue: TuiRendererIssueEvidence) {
  return issue.status !== "closed" && issue.status !== "mitigated"
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort()
}

function countByLayer(issues: TuiRendererIssueEvidence[]): Record<TuiRendererIssueLayer, number> {
  return {
    "product-layer": issues.filter((issue) => issue.layer === "product-layer").length,
    "integration-layer": issues.filter((issue) => issue.layer === "integration-layer").length,
    "renderer-specific": issues.filter((issue) => issue.layer === "renderer-specific").length,
  }
}

function failureIDs(issues: TuiRendererIssueEvidence[]) {
  return unique(
    issues.flatMap((issue) => {
      if (issue.criteriaFailures?.length) return issue.criteriaFailures
      return [issue.id]
    }),
  )
}

export function summarizeTuiRendererEvidence(input: TuiRendererEvidenceInput): TuiRendererEvidenceSummary {
  const active = input.issues.filter(isActive)
  const reproducible = active.filter((issue) => issue.reproducible)
  const rendererSpecific = reproducible.filter((issue) => issue.layer === "renderer-specific")
  const nonRenderer = reproducible.filter((issue) => issue.layer !== "renderer-specific")
  const isolatedRenderer = rendererSpecific.length > 0 && nonRenderer.length === 0
  const decisionIssues = isolatedRenderer ? rendererSpecific : reproducible
  const issueLayer = isolatedRenderer ? "renderer-specific" : (nonRenderer[0]?.layer ?? reproducible[0]?.layer)
  const criteriaFailures = failureIDs(decisionIssues)

  return {
    total: input.issues.length,
    active: active.length,
    reproducible: reproducible.length,
    rendererSpecific: rendererSpecific.length,
    needsRepro: active
      .filter((issue) => issue.status === "needs-repro" || !issue.reproducible)
      .map((issue) => issue.id)
      .sort(),
    criteriaFailures,
    byLayer: countByLayer(active),
    decision: decideTuiRenderer({
      criteriaFailures,
      issueLayer,
      blocksProductDirection: decisionIssues.some((issue) => issue.blocksProductDirection === true),
      installOrBuildRiskAccepted: input.installOrBuildRiskAccepted === true,
      offlinePackagingDeterministic: input.offlinePackagingDeterministic,
    }),
  }
}
