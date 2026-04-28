import type { PromptInfo } from "../../component/prompt/history"
import type { SyncedSessionQualityReadiness } from "../../context/sync-session-risk"
import type { SeverityCounts } from "@/quality/finding-counts"
import type { VerificationEnvelope } from "@/quality/verification-envelope"
import type { DebugCase, DebugHypothesis } from "@/debug-engine/runtime-debug"
import { ProbabilisticRollout } from "@/quality/probabilistic-rollout"
import { SessionDebug } from "@/session/debug"

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

function promptForAction(input: { sessionID: string; action: SessionQualityAction }): PromptInfo {
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
    input.quality?.review ? { workflow: "review" as const, summary: input.quality.review } : null,
    input.quality?.debug ? { workflow: "debug" as const, summary: input.quality.debug } : null,
    input.quality?.qa ? { workflow: "qa" as const, summary: input.quality.qa } : null,
  ].filter((item): item is { workflow: SessionQualityWorkflow; summary: SyncedSessionQualityReadiness } => !!item)

  return items.map(({ workflow, summary }) => {
    const kind = actionKind(summary)
    const title =
      kind === "benchmark"
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

// Decides whether a workflow's quality entry should appear in the sidebar.
// The sidebar only surfaces file-anchored severity-graded findings — those
// are directly actionable. Replay-readiness gates (exportable-session-shape,
// workflow-evidence-present, label-coverage, benchmark-readiness) are an
// internal QA training-pipeline metric: for ordinary coding sessions, anchor
// items and labels are never produced, so these gates are structurally
// failing/warning and would otherwise surface as a perpetual "N issues" row
// the user can't act on. The /quality dialog still shows every workflow with
// a summary regardless, since opening it is an explicit opt-in.
export function hasSidebarSignal(_action: Pick<SessionQualityAction, "summary">, findingCount?: number): boolean {
  return (findingCount ?? 0) > 0
}

// User-facing one-liner for the sidebar Quality section. Renders only the
// finding-count breakdown — the row is gated by hasSidebarSignal so this is
// only called when counts.total > 0.
export function renderSessionQualitySidebarLine(
  action: Pick<SessionQualityAction, "workflow">,
  opts: { counts: SeverityCounts },
): string {
  const label = sessionQualityWorkflowLabel(action.workflow)
  const { counts } = opts
  const parts: string[] = []
  if (counts.CRITICAL > 0) parts.push(`${counts.CRITICAL} CRITICAL`)
  if (counts.HIGH > 0) parts.push(`${counts.HIGH} HIGH`)
  if (counts.MEDIUM > 0) parts.push(`${counts.MEDIUM} MED`)
  if (counts.LOW > 0) parts.push(`${counts.LOW} LOW`)
  if (counts.INFO > 0) parts.push(`${counts.INFO} INFO`)
  return `${label} · ${parts.join(" · ")}`
}

// One-line summary for the sidebar Checks section. Aggregates a session's
// VerificationEnvelope[] by check type (typecheck / lint / tests) and renders
// pass/fail/skipped icons. Returns "" when there are no envelopes — the
// sidebar should not show the section at all in that case.
//
// "Skipped" wins over "passed" when ANY envelope of a kind was skipped,
// because skipped is more user-relevant than green ("did this run at all?").
// "Failed" wins over both, because a single failure must surface even if
// other runs of the same kind passed.
export function renderSessionChecksSummary(envelopes: readonly VerificationEnvelope[]): string {
  if (envelopes.length === 0) return ""

  type Kind = "typecheck" | "lint" | "test"
  type Status = "passed" | "failed" | "skipped" | "missing"

  const aggregateStatus = (kind: Kind): { status: Status; failedCount: number } => {
    const same = envelopes.filter((e) => e.command.runner === kind)
    if (same.length === 0) return { status: "missing", failedCount: 0 }
    let hasFail = false
    let hasSkip = false
    let failedCount = 0
    for (const env of same) {
      if (env.result.status === "failed" || env.result.status === "error" || env.result.status === "timeout") {
        hasFail = true
        failedCount += 1
      } else if (env.result.status === "skipped") {
        hasSkip = true
      }
    }
    if (hasFail) return { status: "failed", failedCount }
    if (hasSkip) return { status: "skipped", failedCount: 0 }
    return { status: "passed", failedCount: 0 }
  }

  const labelFor = (kind: Kind): string => (kind === "test" ? "tests" : kind)

  const formatPart = (kind: Kind): string | null => {
    const { status, failedCount } = aggregateStatus(kind)
    const label = labelFor(kind)
    if (status === "missing") return null
    if (status === "passed") return `${label} ✓`
    if (status === "skipped") return `${label} ⏭`
    return failedCount > 1 ? `${label} ✗ ${failedCount}` : `${label} ✗`
  }

  const parts = (["typecheck", "lint", "test"] as const).map(formatPart).filter((part): part is string => part !== null)

  if (parts.length === 0) return ""
  return parts.join(" · ")
}

// One-line summary for the sidebar Debug Cases section. Renders a count of
// cases by effective status, prioritising the user-relevant signals
// "unresolved" (something we tried and gave up on) and "investigating"
// (work in progress). All-pass / no-cases returns "" so the sidebar
// hides the section entirely.
export function renderSessionDebugCasesSummary(input: {
  cases: readonly DebugCase[]
  hypotheses: readonly DebugHypothesis[]
}): string {
  if (input.cases.length === 0) return ""

  const rolledUp = SessionDebug.rollup({
    cases: [...input.cases],
    evidence: [],
    hypotheses: [...input.hypotheses],
  })

  let unresolved = 0
  let investigating = 0
  let resolved = 0
  let open = 0
  for (const c of rolledUp) {
    if (c.effectiveStatus === "unresolved") unresolved++
    else if (c.effectiveStatus === "investigating") investigating++
    else if (c.effectiveStatus === "resolved") resolved++
    else open++
  }

  const parts: string[] = []
  if (unresolved > 0) parts.push(`${unresolved} unresolved`)
  if (investigating > 0) parts.push(`${investigating} investigating`)
  if (open > 0) parts.push(`${open} open`)
  if (resolved > 0) parts.push(`${resolved} resolved`)

  return parts.join(" · ")
}

export function renderSessionQualityPrompt(action: SessionQualityAction, sessionID: string) {
  const recommended = targetedQATestRecommendations(action.summary)
  const lines = [`Quality readiness context for session ${sessionID}:`, renderSessionQualityBrief(action), ""]

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
