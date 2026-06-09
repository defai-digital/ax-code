import type {
  ReplayReadinessGate,
  ReplayReadinessSummary,
  UserFacingReadinessKind,
  UserFacingReadinessState,
  Workflow,
} from "./probabilistic-rollout-schema"

type ReadinessCountSummary = Pick<
  ReplayReadinessSummary,
  "totalItems" | "labeledItems" | "resolvedLabeledItems" | "unresolvedLabeledItems" | "missingLabels"
>

type ReadinessStateSummary = Pick<
  ReplayReadinessSummary,
  | "readyForBenchmark"
  | "totalItems"
  | "labeledItems"
  | "resolvedLabeledItems"
  | "unresolvedLabeledItems"
  | "missingLabels"
  | "gates"
>

function readinessSeverity(status: ReplayReadinessGate["status"]) {
  return status === "fail" ? 2 : status === "warn" ? 1 : 0
}

// Gates whose failure means the replay export itself is broken (no anchor
// items, no workflow evidence). These are real, user-visible breakage; gates
// outside this set that fail/warn are pipeline progress signals (label
// coverage, benchmark readiness) that are noisy for ordinary sessions.
export const BLOCKING_GATE_NAMES = ["exportable-session-shape", "workflow-evidence-present"] as const

function findBlockingGate(gates: ReadonlyArray<ReplayReadinessGate> | undefined) {
  const list = gates ?? []
  return (
    list.find((gate) => gate.status === "fail" && (BLOCKING_GATE_NAMES as readonly string[]).includes(gate.name)) ??
    list.find((gate) => gate.status === "fail")
  )
}

export function summarizeReplayReadinessOverall(gates: ReplayReadinessGate[]) {
  const highest = gates.reduce((max, gate) => Math.max(max, readinessSeverity(gate.status)), 0)
  return highest === 2 ? "fail" : highest === 1 ? "warn" : "pass"
}

function normalizedReadinessCounts(summary: ReadinessCountSummary) {
  const totalItems = Math.max(summary.totalItems, 0)
  const resolvedLabeledItems = Math.min(Math.max(summary.resolvedLabeledItems, 0), totalItems)
  const declaredLabeledItems = Math.max(summary.labeledItems ?? 0, 0)
  const declaredUnresolvedLabeledItems = Math.max(summary.unresolvedLabeledItems ?? 0, 0)
  const labeledItems = Math.min(
    totalItems,
    Math.max(declaredLabeledItems, resolvedLabeledItems + declaredUnresolvedLabeledItems),
  )
  const unresolvedLabeledItems = Math.min(
    totalItems - resolvedLabeledItems,
    Math.max(declaredUnresolvedLabeledItems, labeledItems - resolvedLabeledItems),
  )
  const missingLabels = Math.max(0, totalItems - labeledItems)

  return {
    totalItems,
    resolvedLabeledItems,
    labeledItems,
    unresolvedLabeledItems,
    missingLabels,
  }
}

function workflowPromptLabel(workflow: Workflow) {
  return workflow === "qa" ? "QA" : workflow
}

function normalizedLabelCoverageMode(summary: ReadinessCountSummary) {
  const counts = normalizedReadinessCounts(summary)
  if (counts.missingLabels === 0 && counts.unresolvedLabeledItems === 0) return "complete" as const
  if (counts.missingLabels > 0 && counts.unresolvedLabeledItems === 0) return "missing_only" as const
  if (counts.missingLabels === 0 && counts.unresolvedLabeledItems > 0) return "unresolved_only" as const
  return "mixed" as const
}

export function readinessState(summary: ReadinessStateSummary): UserFacingReadinessState {
  const counts = normalizedReadinessCounts(summary)
  const blockingGate = findBlockingGate(summary.gates)
  if (summary.readyForBenchmark) return "ready"
  if (blockingGate) return "blocked"
  if (counts.totalItems === 0) return "blocked"
  if (counts.missingLabels > 0 || counts.unresolvedLabeledItems > 0) return "needs_labels"
  return "not_ready"
}

export function readinessStateLabel(summary: ReadinessStateSummary) {
  const state = readinessState(summary)
  if (state === "needs_labels") return "needs labels"
  if (state === "not_ready") return "not ready"
  return state
}

export function readinessStateKind(
  summary: ReadinessStateSummary & Pick<ReplayReadinessSummary, "overallStatus">,
): UserFacingReadinessKind {
  if (summary.overallStatus === "fail") return "high"
  if (summary.overallStatus === "warn") return "medium"
  return "low"
}

export function readinessCounts(summary: ReadinessCountSummary) {
  return normalizedReadinessCounts(summary)
}

export function readinessResolvedLabelsSummary(summary: ReadinessCountSummary) {
  const counts = normalizedReadinessCounts(summary)
  return `${counts.resolvedLabeledItems}/${counts.totalItems} resolved labels`
}

export function readinessDetailLabel(summary: ReadinessStateSummary) {
  const state = readinessState(summary)
  if (state === "blocked") {
    return findBlockingGate(summary.gates)?.detail ?? "no replay evidence yet"
  }
  if (state === "ready") return `benchmark ready · ${readinessResolvedLabelsSummary(summary)}`
  if (state === "not_ready") return `label coverage complete · ${readinessResolvedLabelsSummary(summary)}`

  const counts = normalizedReadinessCounts(summary)
  const detail = [readinessResolvedLabelsSummary(summary)]
  if (counts.missingLabels > 0) detail.push(`${counts.missingLabels} missing`)
  if (counts.unresolvedLabeledItems > 0) detail.push(`${counts.unresolvedLabeledItems} unresolved`)
  return detail.join(" · ")
}

export function readinessNextActionLabel(
  summary: ReadinessStateSummary & Pick<ReplayReadinessSummary, "workflow" | "nextAction">,
): string | null {
  const nextAction = summary.nextAction?.trim() || null
  const state = readinessState(summary)

  if (state === "ready") {
    return nextAction || "Ready to benchmark the current replay export."
  }

  if (state === "blocked") {
    return (
      nextAction || `Capture ${workflowPromptLabel(summary.workflow)} workflow activity before exporting replay again.`
    )
  }

  const coverageMode = normalizedLabelCoverageMode(summary)
  const fallback =
    coverageMode === "complete"
      ? `Check ${workflowPromptLabel(summary.workflow)} replay readiness gates before benchmarking.`
      : coverageMode === "missing_only"
        ? "Record outcome labels for the remaining exported artifacts."
        : coverageMode === "unresolved_only"
          ? "Revisit unresolved outcome labels using the current session evidence."
          : "Finish label coverage for the remaining exported artifacts."

  if (!nextAction) return fallback

  if (
    nextAction === "Finish label coverage for the remaining exported artifacts." ||
    nextAction === "Finish QA label coverage for the remaining exported test artifacts." ||
    nextAction === "Record QA outcomes for the exported test artifacts." ||
    nextAction === "Resolve at least one QA label before benchmarking." ||
    nextAction === "Resolve at least one exported artifact label before benchmarking."
  ) {
    return fallback
  }

  return nextAction
}

export function renderReplayReadinessReport(summary: ReplayReadinessSummary) {
  const lines: string[] = []
  lines.push("## ax-code quality replay readiness")
  lines.push("")
  lines.push(`- workflow: ${summary.workflow}`)
  lines.push(`- session id: ${summary.sessionID}`)
  lines.push(`- project id: ${summary.projectID}`)
  lines.push(`- exported at: ${summary.exportedAt}`)
  lines.push(`- overall status: ${summary.overallStatus}`)
  lines.push(`- total items: ${summary.totalItems}`)
  lines.push(`- anchor items: ${summary.anchorItems}`)
  lines.push(`- evidence items: ${summary.evidenceItems}`)
  lines.push(`- tool summaries: ${summary.toolSummaryCount}`)
  lines.push(`- labeled items: ${summary.labeledItems}`)
  lines.push(`- resolved labels: ${summary.resolvedLabeledItems}`)
  lines.push(`- unresolved labels: ${summary.unresolvedLabeledItems}`)
  lines.push(`- missing labels: ${summary.missingLabels}`)
  lines.push(`- ready for benchmark: ${summary.readyForBenchmark}`)
  lines.push(`- next action: ${readinessNextActionLabel(summary) ?? "none"}`)
  lines.push("")
  for (const gate of summary.gates) {
    lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
  }
  lines.push("")
  return lines.join("\n")
}

export function targetedTestRecommendations(summary: Pick<ReplayReadinessSummary, "workflow" | "gates">) {
  if (summary.workflow !== "qa") return []
  const gate = summary.gates.find((item) => item.name === "targeted-test-recommendation")
  if (!gate) return []
  const separator = gate.detail.indexOf(":")
  if (separator === -1) return []
  return gate.detail
    .slice(separator + 1)
    .split("|")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}
