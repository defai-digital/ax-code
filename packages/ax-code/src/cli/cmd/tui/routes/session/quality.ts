import type { PromptInfo } from "../../component/prompt/history"
import type { SyncedSessionQualityReadiness } from "../../context/sync-session-risk"
import type { SeverityCounts } from "@/quality/finding-counts"
import { ProbabilisticRollout } from "@/quality/probabilistic-rollout"

export type SessionQualityWorkflow = "review" | "debug" | "qa"

type SessionQualitySet =
  | {
      review?: SyncedSessionQualityReadiness | null
      debug?: SyncedSessionQualityReadiness | null
      qa?: SyncedSessionQualityReadiness | null
    }
  | null
  | undefined

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
  quality: SessionQualitySet
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

export function sessionQualityWorkflowLabel(workflow: SessionQualityWorkflow) {
  if (workflow === "review") return "Review"
  if (workflow === "debug") return "Debug"
  return "QA"
}

export function sessionQualityWorkflowIcon(workflow: SessionQualityWorkflow) {
  if (workflow === "review") return "R"
  if (workflow === "debug") return "D"
  return "Q"
}

function workflowPromptLabel(workflow: SessionQualityWorkflow) {
  return workflow === "qa" ? "QA" : workflow
}

function workflowInlineLabel(workflow: SessionQualityWorkflow) {
  return workflow === "qa" ? "qa" : workflow
}

function targetedQATestRecommendations(summary: SyncedSessionQualityReadiness) {
  return ProbabilisticRollout.targetedTestRecommendations(summary)
}

function actionKind(summary: SyncedSessionQualityReadiness): SessionQualityActionKind {
  const readiness = ProbabilisticRollout.readinessState(summary)
  if (readiness === "ready") return "benchmark"
  if (readiness === "blocked") return "capture_evidence"
  return "finish_label_coverage"
}

function normalizedLabelCounts(summary: SyncedSessionQualityReadiness) {
  return ProbabilisticRollout.readinessCounts(summary)
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
  return ProbabilisticRollout.readinessResolvedLabelsSummary(summary)
}

function labelCoverageStatusSummary(summary: SyncedSessionQualityReadiness) {
  return ProbabilisticRollout.readinessDetailLabel(summary)
}

function captureEvidenceStatusSummary(summary: SyncedSessionQualityReadiness) {
  return ProbabilisticRollout.readinessDetailLabel(summary)
}

function labelCoverageMode(summary: SyncedSessionQualityReadiness) {
  const breakdown = labelCoverageBreakdown(summary)
  if (breakdown.missingLabels === 0 && breakdown.unresolvedLabeledItems === 0) return "complete" as const
  if (breakdown.missingLabels > 0 && breakdown.unresolvedLabeledItems === 0) return "missing_only" as const
  if (breakdown.missingLabels === 0 && breakdown.unresolvedLabeledItems > 0) return "unresolved_only" as const
  return "mixed" as const
}

function labelCoverageTitle(workflow: SessionQualityWorkflow, summary: SyncedSessionQualityReadiness) {
  const label = sessionQualityWorkflowLabel(workflow)
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

function normalizedNextAction(summary: SyncedSessionQualityReadiness) {
  return ProbabilisticRollout.readinessNextActionLabel({
    ...summary,
    nextAction: summary.nextAction ?? null,
  })
}

function inlineActionLabel(action: SessionQualityAction) {
  if (action.kind === "capture_evidence") return "capture evidence"
  if (action.kind === "benchmark") return "benchmark replay"

  switch (labelCoverageMode(action.summary)) {
    case "complete":
      return `${workflowInlineLabel(action.workflow)} replay readiness`
    case "missing_only":
      return "record outcome labels"
    case "unresolved_only":
      return "resolve outcome labels"
    default:
      return "finish label coverage"
  }
}

function actionSummaryDetail(action: Pick<SessionQualityAction, "kind" | "summary">) {
  return ProbabilisticRollout.readinessDetailLabel(action.summary)
}

function actionReadinessState(action: Pick<SessionQualityAction, "summary">) {
  return ProbabilisticRollout.readinessStateLabel(action.summary)
}

function targetedRecommendationInlineSuffix(action: Pick<SessionQualityAction, "summary">) {
  const first = targetedQATestRecommendations(action.summary)[0]
  return first ? ` · first: ${first}` : ""
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
  quality: SessionQualitySet
}): SessionQualityAction[] {
  const items = [
    input.quality?.review ? ({ workflow: "review" as const, summary: input.quality.review }) : null,
    input.quality?.debug ? ({ workflow: "debug" as const, summary: input.quality.debug }) : null,
    input.quality?.qa ? ({ workflow: "qa" as const, summary: input.quality.qa }) : null,
  ].filter((item): item is { workflow: SessionQualityWorkflow; summary: SyncedSessionQualityReadiness } => !!item)

  return items.map(({ workflow, summary }) => {
    const kind = actionKind(summary)
    const title = kind === "benchmark"
      ? `Benchmark ${sessionQualityWorkflowLabel(workflow)} Replay`
      : kind === "capture_evidence"
        ? `Capture ${sessionQualityWorkflowLabel(workflow)} Evidence`
        : labelCoverageTitle(workflow, summary)

    const description = `${actionReadinessState({ summary })} · ${actionSummaryDetail({ kind, summary })}`

    const footer = normalizedNextAction(summary) ?? "No additional next action recorded."

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
      description: `${actionReadinessState(action)} · ${actionSummaryDetail(action)}`,
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
  const recommended = targetedQATestRecommendations(action.summary)
  const lines = [
    `Quality readiness · ${action.workflow}`,
    `- readiness state: ${actionReadinessState(action)}`,
    `- benchmark ready: ${action.summary.readyForBenchmark ? "yes" : "no"}`,
    `- next action: ${action.footer}`,
  ]

  if (action.kind === "capture_evidence") {
    const captureSummary = captureEvidenceStatusSummary(action.summary)
    lines.splice(
      3,
      0,
      captureSummary === "no replay evidence yet"
        ? "- replay items: none yet"
        : `- readiness blocker: ${captureSummary}`,
    )
  } else if (action.kind === "finish_label_coverage") {
    const breakdown = labelCoverageBreakdown(action.summary)
    lines.splice(3, 0, `- missing labels: ${breakdown.missingLabels}`)
    lines.splice(4, 0, `- unresolved labels: ${breakdown.unresolvedLabeledItems}`)
    lines.splice(5, 0, `- resolved labels: ${resolvedLabelsSummary(action.summary)}`)
  } else {
    lines.splice(3, 0, `- resolved labels: ${resolvedLabelsSummary(action.summary)}`)
  }

  if (recommended.length > 0) {
    lines.splice(3, 0, `- recommended tests: ${recommended.join(" | ")}`)
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
  return `${inlineActionLabel(action)} · ${actionReadinessState(action)} · ${actionSummaryDetail(action)}${targetedRecommendationInlineSuffix(action)}`
}

// User-facing one-liner for the sidebar Quality section. The verbose internal
// vocabulary (replay readiness, label coverage, capture evidence) stays inside
// the /quality dialog via renderSessionQualityInlineSummary; the sidebar gets
// just status + the most actionable problem detail.
//
// When `counts.total > 0`, finding counts dominate the line — they are
// file-anchored, severity-graded, and directly actionable, so they outrank
// quality-readiness gates which are session-level training-pipeline state.
export function renderSessionQualitySidebarLine(
  action: Pick<SessionQualityAction, "workflow" | "summary">,
  opts?: { counts?: SeverityCounts },
): string {
  const label = sessionQualityWorkflowLabel(action.workflow)
  const counts = opts?.counts

  if (counts && counts.total > 0) {
    const parts: string[] = []
    if (counts.CRITICAL > 0) parts.push(`${counts.CRITICAL} CRITICAL`)
    if (counts.HIGH > 0) parts.push(`${counts.HIGH} HIGH`)
    if (counts.MEDIUM > 0) parts.push(`${counts.MEDIUM} MED`)
    if (counts.LOW > 0) parts.push(`${counts.LOW} LOW`)
    if (counts.INFO > 0) parts.push(`${counts.INFO} INFO`)
    return `${label} · ${parts.join(" · ")}`
  }

  const status = action.summary.overallStatus
  if (status === "pass") return `${label} · ok`

  const problemGates = (action.summary.gates ?? []).filter((g) => g.status !== "pass")
  if (problemGates.length === 0) {
    return `${label} · ${status === "warn" ? "warning" : "needs attention"}`
  }
  if (problemGates.length === 1) {
    return `${label} · ${problemGates[0].detail}`
  }
  const noun = status === "fail" ? "issues" : "warnings"
  return `${label} · ${problemGates.length} ${noun}`
}

export function renderSessionQualityPrompt(action: SessionQualityAction, sessionID: string) {
  const recommended = targetedQATestRecommendations(action.summary)
  const lines = [
    `Quality readiness context for session ${sessionID}:`,
    renderSessionQualityBrief(action),
    "",
  ]

  if (recommended.length > 0) {
    lines.push(`Targeted QA recommendation: run ${recommended[0]} first.`)
    lines.push("")
  }

  if (action.kind === "capture_evidence") {
    lines.push(
      `Use the current session to produce ${workflowPromptLabel(action.workflow)} workflow evidence that will unblock replay readiness.`,
      "1. Focus on the failing or warning readiness gates first.",
      "2. Run or continue the relevant workflow until evidence-bearing output exists in the session.",
      "3. Summarize what new evidence was captured and whether readiness should be refreshed.",
      "4. Do not fabricate results that are not present in the current session.",
    )
    return lines.join("\n")
  }

  if (action.kind === "benchmark") {
    lines.push(
      `Prepare the next benchmark step for the current ${workflowPromptLabel(action.workflow)} replay evidence.`,
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
      `Use the current session's ${workflowPromptLabel(action.workflow)} replay evidence to record the missing outcome labels.`,
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
      `Use the current session's ${workflowPromptLabel(action.workflow)} replay evidence to revisit unresolved outcome labels.`,
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
      `Use the current session's ${workflowPromptLabel(action.workflow)} replay evidence to review the remaining replay-readiness gates.`,
      "1. Confirm that the current exported artifacts already have resolved outcome labels.",
      "2. Inspect the failing or warning readiness gates that still block benchmarking.",
      "3. Summarize what additional evidence, refresh, or workflow activity is still needed.",
      "4. Do not invent benchmark results or additional labels that are not required.",
    )
    return lines.join("\n")
  }

  lines.push(
    `Use the current session's ${workflowPromptLabel(action.workflow)} replay evidence to prepare the remaining labeling work.`,
    `1. Start from the current backlog: ${coverage.missingLabels} missing label(s), ${coverage.unresolvedLabeledItems} unresolved label(s).`,
    "2. Separate artifacts that are missing labels from artifacts that already have unresolved labels.",
    "3. Summarize the evidence available from this session for each unresolved or unlabeled artifact.",
    "4. Flag missing context or uncertainty instead of guessing labels or final outcomes.",
    "5. Stop once the labeling brief is ready; do not invent final outcomes.",
  )
  return lines.join("\n")
}
