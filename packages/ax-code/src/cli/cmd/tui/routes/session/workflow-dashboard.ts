import type { WorkflowArtifactEventRecord, WorkflowRunDashboardResponse, WorkflowRunGetResponse } from "@ax-code/sdk/v2"

export type WorkflowDashboardRun = WorkflowRunDashboardResponse[number]
export type WorkflowRunDetail = WorkflowRunGetResponse
export type WorkflowRunArtifact = WorkflowArtifactEventRecord
export type WorkflowRunControlAction = "pause" | "resume" | "cancel" | "retry"

export type WorkflowDashboardItem = {
  title: string
  value: string
  description?: string
  footer?: string
  category: string
  disabled?: boolean
}

export type WorkflowRunControlItem = WorkflowDashboardItem & {
  action: WorkflowRunControlAction
}

const MAX_TITLE = 46
const MAX_DESCRIPTION = 118
const MAX_FOOTER = 118
const ARTIFACT_DETAIL_VALUE_PREFIX = "workflow.detail.artifact."

export function workflowDashboardItems(runs: WorkflowDashboardRun[]): WorkflowDashboardItem[] {
  if (runs.length === 0) {
    return [
      {
        title: "No workflow runs found",
        value: "workflow.empty",
        description: "Workflow runtime is enabled, but this project has no durable workflow runs yet.",
        category: "Overview",
        disabled: true,
      },
    ]
  }

  return runs.map((run) => {
    const activeChildren = run.childCounts.running + run.childCounts.blockedPermission + run.childCounts.blockedQuestion
    const phase = run.currentPhaseName ?? run.currentPhaseID ?? "no active phase"
    const budget = formatWorkflowBudget(run.budgetUsage.totalTokens ?? 0, run.budgetLimit.maxTotalTokens)
    const childSummary = `${activeChildren} active, ${run.childCounts.queued} queued, ${run.budgetUsage.childAgents ?? 0} total`
    const verification = `${run.verificationEnvelopeCount} verification`
    const artifacts = `${totalArtifacts(run)} artifacts`
    const blocker = run.blockedReason ? `blocker: ${run.blockedReason}` : undefined

    return {
      title: truncate(`${statusLabel(run.status)} ${run.name}`, MAX_TITLE),
      value: run.runID,
      description: truncate(
        `phase: ${phase} (${run.currentPhaseStatus ?? run.status}) | children: ${childSummary} | tokens: ${budget}`,
        MAX_DESCRIPTION,
      ),
      footer: truncate(
        [blocker, `effort: ${run.effort}`, verification, artifacts, `elapsed: ${formatWorkflowDuration(run.elapsedMs)}`]
          .filter(Boolean)
          .join(" | "),
        MAX_FOOTER,
      ),
      category: statusCategory(run.status),
    }
  })
}

export function workflowRunDetailItems(detail: WorkflowRunDetail): WorkflowDashboardItem[] {
  const limits = workflowBudgetLimits(detail)
  const items: WorkflowDashboardItem[] = [
    {
      title: truncate(`${statusLabel(detail.status)} ${detail.spec.name}`, MAX_TITLE),
      value: "workflow.detail.overview",
      description: truncate(
        `run: ${detail.id} | template: ${detail.sourceTemplateID ?? "ad hoc"} | current phase: ${
          detail.currentPhaseID ?? "none"
        }`,
        MAX_DESCRIPTION,
      ),
      footer: truncate(
        `budget: ${formatWorkflowBudget(detail.budgetUsage.totalTokens ?? 0, limits.maxTotalTokens)} tokens | ${
          detail.budgetUsage.childAgents ?? 0
        }/${limits.maxTotalAgents} child agents | ${detail.budgetUsage.toolCalls ?? 0}/${limits.maxToolCalls} tool calls`,
        MAX_FOOTER,
      ),
      category: "Overview",
      disabled: true,
    },
    {
      title: "Verification and artifacts",
      value: "workflow.detail.evidence",
      description: truncate(
        `${detail.verificationEnvelopeIDs.length} verification envelopes | ${detail.artifacts.length} artifacts | ${
          detail.artifacts.filter((artifact) => artifact.exposeToMainContext).length
        } exposed to parent context`,
        MAX_DESCRIPTION,
      ),
      footer: detail.error ? truncate(`error: ${detail.error}`, MAX_FOOTER) : undefined,
      category: "Overview",
      disabled: true,
    },
  ]

  for (const phase of detail.phases) {
    items.push({
      title: truncate(`${phase.position + 1}. ${phase.name}`, MAX_TITLE),
      value: `workflow.detail.phase.${phase.id}`,
      description: truncate(`${phase.kind} | ${phase.status} | spec: ${phase.specPhaseID}`, MAX_DESCRIPTION),
      footer: phase.error ? truncate(`error: ${phase.error}`, MAX_FOOTER) : undefined,
      category: "Phases",
      disabled: true,
    })
  }

  for (const child of detail.children) {
    const model = typeof child.model === "string" ? child.model : child.model ? "custom model" : "default model"
    items.push({
      title: truncate(`${statusLabel(child.status)} ${child.agent ?? "workflow child"}`, MAX_TITLE),
      value: `workflow.detail.child.${child.id}`,
      description: truncate(
        `phase: ${child.phaseID} | model: ${model} | artifacts: ${child.artifactIDs.length}`,
        MAX_DESCRIPTION,
      ),
      footer: truncate(child.error ?? child.outputSummary ?? child.taskQueueID ?? child.sessionID ?? "", MAX_FOOTER),
      category: "Children",
      disabled: true,
    })
  }

  for (const artifact of detail.artifacts) {
    items.push({
      title: truncate(`${artifact.kind} ${artifact.id}`, MAX_TITLE),
      value: `${ARTIFACT_DETAIL_VALUE_PREFIX}${artifact.id}`,
      description: truncate(
        `${artifact.retention}${artifact.exposeToMainContext ? " | exposed" : ""}${
          artifact.redaction?.status ? ` | redaction: ${artifact.redaction.status}` : ""
        }`,
        MAX_DESCRIPTION,
      ),
      footer: artifact.summary ? truncate(artifact.summary, MAX_FOOTER) : undefined,
      category: "Artifacts",
    })
  }

  if (detail.budgetLedger.length > 0) {
    for (const entry of detail.budgetLedger.slice(-8)) {
      items.push({
        title: truncate(
          `${entry.kind} ${formatWorkflowBudget(entry.usageDelta.totalTokens ?? 0, limits.maxTotalTokens)}`,
          MAX_TITLE,
        ),
        value: `workflow.detail.budget.${entry.id}`,
        description: truncate(
          `${entry.usageDelta.childAgents ?? 0} child agents | ${entry.usageDelta.toolCalls ?? 0} tool calls | ${
            entry.usageDelta.retries ?? 0
          } retries`,
          MAX_DESCRIPTION,
        ),
        footer: entry.message ? truncate(entry.message, MAX_FOOTER) : undefined,
        category: "Budget",
        disabled: true,
      })
    }
  }

  return items
}

export function workflowRunControlItems(detail: WorkflowRunDetail): WorkflowRunControlItem[] {
  const items: WorkflowRunControlItem[] = []

  if (detail.status === "queued" || detail.status === "running" || detail.status === "blocked") {
    items.push({
      title: "Pause workflow run",
      value: "workflow.detail.control.pause",
      description: "Pause queued workflow children and keep durable run state available for resume.",
      category: "Controls",
      action: "pause",
    })
  }

  if (detail.status === "paused") {
    items.push({
      title: "Resume workflow run",
      value: "workflow.detail.control.resume",
      description: "Resume paused workflow queue children and continue the run.",
      category: "Controls",
      action: "resume",
    })
  }

  if (
    detail.status === "queued" ||
    detail.status === "running" ||
    detail.status === "blocked" ||
    detail.status === "paused"
  ) {
    items.push({
      title: "Cancel workflow run",
      value: "workflow.detail.control.cancel",
      description: "Stop queued workflow children and mark the workflow run cancelled.",
      category: "Controls",
      action: "cancel",
    })
  }

  if (detail.status === "failed" || detail.status === "cancelled") {
    items.push({
      title: "Retry workflow run",
      value: "workflow.detail.control.retry",
      description: "Retry failed or cancelled workflow queue children from durable state.",
      category: "Controls",
      action: "retry",
    })
  }

  return items
}

export function workflowArtifactDetailItems(artifact: WorkflowRunArtifact): WorkflowDashboardItem[] {
  const items: WorkflowDashboardItem[] = [
    {
      title: truncate(`${artifact.kind} ${artifact.id}`, MAX_TITLE),
      value: "workflow.artifact.overview",
      description: truncate(
        `${artifact.retention}${artifact.exposeToMainContext ? " | exposed" : ""}${
          artifact.redaction?.status ? ` | redaction: ${artifact.redaction.status}` : ""
        }`,
        MAX_DESCRIPTION,
      ),
      footer: artifact.redaction?.summary
        ? truncate(`redaction: ${artifact.redaction.summary}`, MAX_FOOTER)
        : undefined,
      category: "Overview",
      disabled: true,
    },
    {
      title: "Artifact scope",
      value: "workflow.artifact.scope",
      description: truncate(
        [
          artifact.phaseID ? `phase: ${artifact.phaseID}` : undefined,
          artifact.childID ? `child: ${artifact.childID}` : undefined,
          artifact.specArtifactID ? `spec: ${artifact.specArtifactID}` : undefined,
        ]
          .filter(Boolean)
          .join(" | ") || "run-level artifact",
        MAX_DESCRIPTION,
      ),
      footer: `created: ${artifact.time.created}`,
      category: "Overview",
      disabled: true,
    },
  ]

  if (artifact.summary) {
    items.push({
      title: "Summary",
      value: "workflow.artifact.summary",
      description: truncate(artifact.summary, MAX_DESCRIPTION),
      category: "Content",
      disabled: true,
    })
  }

  items.push({
    title: "Payload preview",
    value: "workflow.artifact.payload",
    description: truncate(workflowArtifactPayloadPreview(artifact.payload), MAX_DESCRIPTION),
    footer:
      artifact.payload === undefined
        ? undefined
        : truncate(workflowArtifactPayloadPreview(artifact.payload, true), MAX_FOOTER),
    category: "Content",
    disabled: true,
  })

  if (artifact.evidenceRefs.length === 0) {
    items.push({
      title: "No evidence refs",
      value: "workflow.artifact.evidence.empty",
      description: "This artifact has no linked verification, finding, or debug evidence refs.",
      category: "Evidence",
      disabled: true,
    })
  } else {
    for (const ref of artifact.evidenceRefs) {
      items.push({
        title: truncate(`${ref.kind} ${ref.id}`, MAX_TITLE),
        value: `workflow.artifact.evidence.${ref.kind}.${ref.id}`,
        description: "Linked evidence reference for this workflow artifact.",
        category: "Evidence",
        disabled: true,
      })
    }
  }

  return items
}

export function workflowArtifactIDFromDetailValue(value: string) {
  if (!value.startsWith(ARTIFACT_DETAIL_VALUE_PREFIX)) return undefined
  return value.slice(ARTIFACT_DETAIL_VALUE_PREFIX.length) || undefined
}

function workflowBudgetLimits(detail: WorkflowRunDetail) {
  const source = detail.budget as Record<string, unknown>
  return {
    maxTotalTokens: numberField(source.maxTotalTokens, detail.spec.budget?.maxTotalTokens),
    maxTotalAgents: numberField(source.maxTotalAgents, detail.spec.budget?.maxTotalAgents),
    maxToolCalls: numberField(source.maxToolCalls, detail.spec.budget?.maxToolCalls),
  }
}

export function statusLabel(status: string) {
  return `[${status}]`
}

export function statusCategory(status: WorkflowDashboardRun["status"]) {
  if (status === "running" || status === "queued") return "Active"
  if (status === "blocked" || status === "paused") return "Needs attention"
  if (status === "failed" || status === "cancelled") return "Stopped"
  return "Completed"
}

export function formatWorkflowDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)

  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`
  return `${seconds}s`
}

function formatWorkflowBudget(used: number, limit: number) {
  return `${used}/${limit}`
}

function totalArtifacts(run: WorkflowDashboardRun) {
  return Object.values(run.artifactCounts).reduce((sum, value) => sum + value, 0)
}

function numberField(primary: unknown, fallback: unknown) {
  if (typeof primary === "number" && Number.isFinite(primary)) return primary
  if (typeof fallback === "number" && Number.isFinite(fallback)) return fallback
  return 0
}

function truncate(value: string, max: number) {
  if (value.length <= max) return value
  return value.slice(0, Math.max(0, max - 3)) + "..."
}

function workflowArtifactPayloadPreview(payload: unknown, multiline = false) {
  if (payload === undefined) return "No payload stored for this artifact."
  if (typeof payload === "string") return payload
  if (typeof payload === "number" || typeof payload === "boolean" || payload === null) return String(payload)
  try {
    return JSON.stringify(payload, null, multiline ? 2 : 0)
  } catch {
    return String(payload)
  }
}
