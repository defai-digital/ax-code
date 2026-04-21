import type { PromptInfo } from "../../component/prompt/history"
import type { SyncedSessionQualityReadiness } from "../../context/sync-session-risk"

export type SessionQualityWorkflow = "review" | "debug"

export type SessionQualityActionKind = "capture_evidence" | "finish_label_coverage" | "benchmark"

export type SessionQualityAction = {
  workflow: SessionQualityWorkflow
  kind: SessionQualityActionKind
  summary: SyncedSessionQualityReadiness
  title: string
  description: string
  footer: string
  prompt: PromptInfo
}

export function sessionQualityActionValue(action: Pick<SessionQualityAction, "workflow" | "kind">) {
  return `session.quality.${action.workflow}.${action.kind}`
}

export function findSessionQualityAction(input: {
  sessionID: string
  workflow: SessionQualityWorkflow
  kind: SessionQualityActionKind
  quality:
    | {
        review?: SyncedSessionQualityReadiness | null
        debug?: SyncedSessionQualityReadiness | null
      }
    | null
    | undefined
}) {
  return sessionQualityActions({
    sessionID: input.sessionID,
    quality: input.quality,
  }).find((action) => action.workflow === input.workflow && action.kind === input.kind)
}

export type SessionQualityDetailItem = {
  id: string
  title: string
  description: string
  footer?: string
  category: string
  action?: SessionQualityAction
}

function workflowLabel(workflow: SessionQualityWorkflow) {
  return workflow === "review" ? "Review" : "Debug"
}

function actionKind(summary: SyncedSessionQualityReadiness): SessionQualityActionKind {
  if (summary.readyForBenchmark) return "benchmark"
  if (summary.totalItems === 0) return "capture_evidence"
  return "finish_label_coverage"
}

function normalizedLabelCounts(summary: SyncedSessionQualityReadiness) {
  const totalItems = Math.max(summary.totalItems, 0)
  const resolvedLabeledItems = Math.min(Math.max(summary.resolvedLabeledItems, 0), totalItems)
  const declaredLabeledItems = Math.max(summary.labeledItems ?? 0, 0)
  const declaredUnresolvedLabeledItems = Math.max(summary.unresolvedLabeledItems ?? 0, 0)
  const labeledItems = Math.min(totalItems, Math.max(declaredLabeledItems, resolvedLabeledItems + declaredUnresolvedLabeledItems))
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

function labelCoverageBreakdown(summary: SyncedSessionQualityReadiness) {
  const counts = normalizedLabelCounts(summary)
  return {
    labeledItems: counts.labeledItems,
    missingLabels: counts.missingLabels,
    unresolvedLabeledItems: counts.unresolvedLabeledItems,
  }
}

function resolvedLabelsSummary(summary: SyncedSessionQualityReadiness) {
  const counts = normalizedLabelCounts(summary)
  return `${counts.resolvedLabeledItems}/${counts.totalItems} resolved labels`
}

function labelCoverageStatusSummary(summary: SyncedSessionQualityReadiness) {
  const breakdown = labelCoverageBreakdown(summary)
  const detail = [resolvedLabelsSummary(summary)]

  if (breakdown.missingLabels > 0) {
    detail.push(`${breakdown.missingLabels} missing`)
  }
  if (breakdown.unresolvedLabeledItems > 0) {
    detail.push(`${breakdown.unresolvedLabeledItems} unresolved`)
  }

  return detail.join(" · ")
}

function labelCoverageMode(summary: SyncedSessionQualityReadiness) {
  const breakdown = labelCoverageBreakdown(summary)
  if (breakdown.missingLabels === 0 && breakdown.unresolvedLabeledItems === 0) return "complete" as const
  if (breakdown.missingLabels > 0 && breakdown.unresolvedLabeledItems === 0) return "missing_only" as const
  if (breakdown.missingLabels === 0 && breakdown.unresolvedLabeledItems > 0) return "unresolved_only" as const
  return "mixed" as const
}

function labelCoverageTitle(workflow: SessionQualityWorkflow, summary: SyncedSessionQualityReadiness) {
  const label = workflowLabel(workflow)
  switch (labelCoverageMode(summary)) {
    case "complete":
      return `Check ${label} Replay Readiness`
    case "missing_only":
      return `Record ${label} Outcome Labels`
    case "unresolved_only":
      return `Resolve ${label} Outcome Labels`
    default:
      return `Finish ${label} Label Coverage`
  }
}

function labelCoverageFooter(summary: SyncedSessionQualityReadiness) {
  switch (labelCoverageMode(summary)) {
    case "complete":
      return "Review replay readiness gates before benchmarking."
    case "missing_only":
      return "Record outcome labels for the remaining exported artifacts."
    case "unresolved_only":
      return "Revisit unresolved outcome labels using the current session evidence."
    default:
      return "Finish label coverage for the remaining exported artifacts."
  }
}

function captureEvidenceFooter(summary: SyncedSessionQualityReadiness) {
  return `Capture ${summary.workflow} workflow activity before exporting replay again.`
}

function normalizedNextAction(input: {
  kind: SessionQualityActionKind
  summary: SyncedSessionQualityReadiness
}) {
  const nextAction = input.summary.nextAction?.trim()
  if (input.kind !== "finish_label_coverage") {
    if (nextAction) return nextAction
    return input.kind === "benchmark" ? "Ready to benchmark the current replay export." : captureEvidenceFooter(input.summary)
  }

  const fallback = labelCoverageFooter(input.summary)
  if (!nextAction) return fallback
  if (nextAction === "Finish label coverage for the remaining exported artifacts.") {
    return fallback
  }
  return nextAction
}

function inlineActionLabel(action: SessionQualityAction) {
  if (action.kind === "capture_evidence") return "capture evidence"
  if (action.kind === "benchmark") return "benchmark replay"

  switch (labelCoverageMode(action.summary)) {
    case "complete":
      return "review replay readiness"
    case "missing_only":
      return "record outcome labels"
    case "unresolved_only":
      return "resolve outcome labels"
    default:
      return "finish label coverage"
  }
}

function actionSummaryDetail(action: Pick<SessionQualityAction, "kind" | "summary">) {
  if (action.kind === "capture_evidence") {
    return "no replay evidence yet"
  }

  if (action.kind === "benchmark") {
    return `benchmark ready · ${resolvedLabelsSummary(action.summary)}`
  }

  if (labelCoverageMode(action.summary) === "complete") {
    return `label coverage complete · ${resolvedLabelsSummary(action.summary)}`
  }

  return labelCoverageStatusSummary(action.summary)
}

function actionStatusTitle(action: Pick<SessionQualityAction, "kind" | "summary">) {
  if (action.kind === "capture_evidence") {
    return "Replay evidence missing"
  }

  if (action.kind === "benchmark") {
    return "Benchmark ready"
  }

  if (labelCoverageMode(action.summary) === "complete") {
    return "Replay readiness incomplete"
  }

  return "Label coverage incomplete"
}

function promptForAction(input: {
  sessionID: string
  action: SessionQualityAction
}): PromptInfo {
  return {
    input: renderSessionQualityPrompt(input.action, input.sessionID),
    parts: [],
  }
}

export function sessionQualityActions(input: {
  sessionID: string
  quality:
    | {
        review?: SyncedSessionQualityReadiness | null
        debug?: SyncedSessionQualityReadiness | null
      }
    | null
    | undefined
}): SessionQualityAction[] {
  const items = [
    input.quality?.review ? ({ workflow: "review" as const, summary: input.quality.review }) : null,
    input.quality?.debug ? ({ workflow: "debug" as const, summary: input.quality.debug }) : null,
  ].filter((item): item is { workflow: SessionQualityWorkflow; summary: SyncedSessionQualityReadiness } => !!item)

  return items.map(({ workflow, summary }) => {
    const kind = actionKind(summary)
    const title = kind === "benchmark"
      ? `Benchmark ${workflowLabel(workflow)} Replay`
      : kind === "capture_evidence"
        ? `Capture ${workflowLabel(workflow)} Evidence`
        : labelCoverageTitle(workflow, summary)

    const description = `${summary.overallStatus} · ${actionSummaryDetail({ kind, summary })}`

    const footer = normalizedNextAction({ kind, summary }) ?? "No additional next action recorded."

    const action = {
      workflow,
      kind,
      summary,
      title,
      description,
      footer,
      prompt: { input: "", parts: [] },
    } satisfies SessionQualityAction

    return {
      ...action,
      prompt: promptForAction({
        sessionID: input.sessionID,
        action,
      }),
    }
  })
}

export function sessionQualityDetailItems(action: SessionQualityAction): SessionQualityDetailItem[] {
  return [
    {
      id: `${sessionQualityActionValue(action)}.prepare`,
      title: action.title,
      description: action.description,
      footer: action.footer,
      category: "Next Step",
      action,
    },
    {
      id: `${sessionQualityActionValue(action)}.status`,
      title: actionStatusTitle(action),
      description: `${action.summary.overallStatus} · ${actionSummaryDetail(action)}`,
      footer: action.footer,
      category: "Status",
    },
    ...(action.summary.gates ?? []).map((gate) => ({
      id: `${sessionQualityActionValue(action)}.gate.${gate.name}`,
      title: `[${gate.status}] ${gate.name}`,
      description: gate.detail,
      category: "Gate",
    })),
  ]
}

export function renderSessionQualityBrief(action: SessionQualityAction) {
  const lines = [
    `Quality readiness · ${action.workflow}`,
    `- overall status: ${action.summary.overallStatus}`,
    `- benchmark ready: ${action.summary.readyForBenchmark ? "yes" : "no"}`,
    `- next action: ${action.footer}`,
  ]

  if (action.kind === "capture_evidence") {
    lines.splice(3, 0, "- replay items: none yet")
  } else if (action.kind === "finish_label_coverage") {
    const breakdown = labelCoverageBreakdown(action.summary)
    lines.splice(3, 0, `- missing labels: ${breakdown.missingLabels}`)
    lines.splice(4, 0, `- unresolved labels: ${breakdown.unresolvedLabeledItems}`)
    lines.splice(5, 0, `- resolved labels: ${resolvedLabelsSummary(action.summary)}`)
  } else {
    lines.splice(3, 0, `- resolved labels: ${resolvedLabelsSummary(action.summary)}`)
  }

  if ((action.summary.gates ?? []).length > 0) {
    lines.push("- gates:")
    for (const gate of action.summary.gates ?? []) {
      lines.push(`  - [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
  }

  return lines.join("\n")
}

export function renderSessionQualityInlineSummary(action: SessionQualityAction) {
  return `${inlineActionLabel(action)} · ${action.summary.overallStatus} · ${actionSummaryDetail(action)}`
}

export function renderSessionQualityPrompt(action: SessionQualityAction, sessionID: string) {
  const lines = [
    `Quality readiness context for session ${sessionID}:`,
    renderSessionQualityBrief(action),
    "",
  ]

  if (action.kind === "capture_evidence") {
    lines.push(
      `Use the current session to produce ${action.workflow} workflow evidence that will unblock replay readiness.`,
      "1. Focus on the failing or warning readiness gates first.",
      "2. Run or continue the relevant workflow until evidence-bearing output exists in the session.",
      "3. Summarize what new evidence was captured and whether readiness should be refreshed.",
      "4. Do not fabricate results that are not present in the current session.",
    )
    return lines.join("\n")
  }

  if (action.kind === "benchmark") {
    lines.push(
      `Prepare the next benchmark step for the current ${action.workflow} replay evidence.`,
      "1. Confirm which evidence and labels are already available from this session.",
      "2. Identify any missing inputs that would still block benchmarking.",
      "3. If the inputs are complete, describe the next benchmark step and expected outputs.",
      "4. Do not invent benchmark results or calibration outcomes.",
    )
    return lines.join("\n")
  }

  const coverage = labelCoverageBreakdown(action.summary)

  if (labelCoverageMode(action.summary) === "missing_only") {
    lines.push(
      `Use the current session's ${action.workflow} replay evidence to record the missing outcome labels.`,
      `1. Start from the current backlog: ${coverage.missingLabels} missing label(s), ${coverage.unresolvedLabeledItems} unresolved label(s).`,
      "2. Identify which exported artifacts are still missing labels.",
      "3. Summarize the available session evidence for each unlabeled artifact.",
      "4. Flag missing context or uncertainty instead of guessing final outcomes.",
      "5. Stop once the labeling brief is ready; do not invent final outcomes.",
    )
    return lines.join("\n")
  }

  if (labelCoverageMode(action.summary) === "unresolved_only") {
    lines.push(
      `Use the current session's ${action.workflow} replay evidence to revisit unresolved outcome labels.`,
      `1. Start from the current backlog: ${coverage.missingLabels} missing label(s), ${coverage.unresolvedLabeledItems} unresolved label(s).`,
      "2. Identify which labeled artifacts still need a resolved outcome.",
      "3. Summarize the current session evidence that could resolve each unresolved label.",
      "4. Flag missing context or uncertainty instead of guessing final outcomes.",
      "5. Stop once the relabeling brief is ready; do not invent final outcomes.",
    )
    return lines.join("\n")
  }

  if (labelCoverageMode(action.summary) === "complete") {
    lines.push(
      `Use the current session's ${action.workflow} replay evidence to review the remaining replay-readiness gates.`,
      "1. Confirm that the current exported artifacts already have resolved outcome labels.",
      "2. Inspect the failing or warning readiness gates that still block benchmarking.",
      "3. Summarize what additional evidence, refresh, or workflow activity is still needed.",
      "4. Do not invent benchmark results or additional labels that are not required.",
    )
    return lines.join("\n")
  }

  lines.push(
    `Use the current session's ${action.workflow} replay evidence to prepare the remaining labeling work.`,
    `1. Start from the current backlog: ${coverage.missingLabels} missing label(s), ${coverage.unresolvedLabeledItems} unresolved label(s).`,
    "2. Separate artifacts that are missing labels from artifacts that already have unresolved labels.",
    "3. Summarize the evidence available from this session for each unresolved or unlabeled artifact.",
    "4. Flag missing context or uncertainty instead of guessing labels or final outcomes.",
    "5. Stop once the labeling brief is ready; do not invent final outcomes.",
  )
  return lines.join("\n")
}
