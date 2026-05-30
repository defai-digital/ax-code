import type { WorkflowDashboardRun, WorkflowDashboardState } from "../../context/sync-runtime-store"

const MAX_WORKFLOW_LINE_NAME = 26
const MAX_WORKFLOW_LINE_PHASE = 22

export function visibleWorkflowSidebarRuns(state: WorkflowDashboardState, limit = 4) {
  const active = state.runs.filter((run) => isActiveWorkflowStatus(run.status))
  const source = active.length > 0 ? active : state.runs
  return source.slice(0, Math.max(0, limit))
}

export function renderWorkflowDashboardHeader(state: WorkflowDashboardState) {
  if (state.runs.length === 0) return "Workflows"
  const parts = [`${state.activeCount} active`]
  if (state.blockedCount > 0) parts.push(`${state.blockedCount} blocked`)
  if (state.evidenceRefCount > 0) parts.push(`${state.evidenceRefCount} evidence`)
  if (state.verificationEnvelopeCount > 0) parts.push(`${state.verificationEnvelopeCount} verified`)
  return `Workflows (${parts.join(", ")})`
}

export function renderWorkflowStatusSidebarLine(run: WorkflowDashboardRun) {
  const phase = run.currentPhaseName ? ` | ${truncate(run.currentPhaseName, MAX_WORKFLOW_LINE_PHASE)}` : ""
  const activeChildren =
    run.childCounts.running +
    run.childCounts.queued +
    run.childCounts.blockedPermission +
    run.childCounts.blockedQuestion
  const totalChildren = Object.values(run.childCounts).reduce((sum, value) => sum + value, 0)
  const budget = `${run.budgetUsage.totalTokens}/${run.budgetLimit.maxTotalTokens} tok`
  const modelPolicy = workflowModelPolicyPart(run)
  const evidence = run.evidenceRefCount
  const evidencePart = evidence > 0 ? ` | evidence ${evidence}` : ""
  const blocked = run.blockedReason ? ` | ${truncate(run.blockedReason, 40)}` : ""

  return `${statusLabel(run.status)} ${truncate(run.name, MAX_WORKFLOW_LINE_NAME)}${phase} | agents ${activeChildren}/${totalChildren} | ${budget} | ${modelPolicy}${evidencePart}${blocked}`
}

export function isWorkflowStatusAttention(status: WorkflowDashboardRun["status"]) {
  return status === "blocked" || status === "failed" || status === "cancelled"
}

function isActiveWorkflowStatus(status: WorkflowDashboardRun["status"]) {
  return status === "queued" || status === "running" || status === "blocked" || status === "paused"
}

function statusLabel(status: WorkflowDashboardRun["status"]) {
  if (status === "blocked") return "blocked"
  if (status === "running") return "running"
  if (status === "paused") return "paused"
  if (status === "queued") return "queued"
  if (status === "failed") return "failed"
  if (status === "cancelled") return "cancelled"
  return "done"
}

function workflowModelPolicyPart(run: WorkflowDashboardRun) {
  const worker = run.models.worker ?? run.models.cheap ?? run.models.default ?? "default"
  const synthesizer = run.models.synthesizer ?? run.models.strong ?? run.models.default ?? "default"
  return `effort ${run.effort} | model ${truncate(`${worker}->${synthesizer}`, 24)}`
}

function truncate(value: string, max: number) {
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 3))}...`
}
