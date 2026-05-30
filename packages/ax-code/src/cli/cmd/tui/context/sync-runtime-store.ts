import type { WorkflowRunProjection } from "@/workflow/projection"

export interface DebugEnginePlan {
  planId: string
  kind: string
  risk: string
  summary: string
  affectedFileCount: number
  affectedSymbolCount: number
  timeCreated: number
}

export interface DebugEnginePayload {
  count: number
  plans: DebugEnginePlan[]
  toolCount?: number
  graph?: {
    nodeCount: number
    edgeCount: number
    lastIndexedAt: number | null
    state?: "idle" | "indexing" | "failed"
    completed?: number
    total?: number
    error?: string | null
  }
}

export interface RuntimeFlagPayload {
  enabled: boolean
}

export interface IsolationPayload {
  mode: "read-only" | "workspace-write" | "full-access"
  network: boolean
}

export type WorkflowDashboardRun = WorkflowRunProjection
export type WorkflowDashboardPayload = WorkflowDashboardRun[] | { runs?: WorkflowDashboardRun[] }

export interface WorkflowDashboardState {
  runs: WorkflowDashboardRun[]
  activeCount: number
  blockedCount: number
  terminalCount: number
  verificationEnvelopeCount: number
  evidenceRefCount: number
  exposedArtifactCount: number
}

export function normalizeDebugEngineState(body: DebugEnginePayload) {
  return {
    pendingPlans: body.count,
    plans: body.plans,
    toolCount: body.toolCount ?? 0,
    graph: {
      nodeCount: body.graph?.nodeCount ?? 0,
      edgeCount: body.graph?.edgeCount ?? 0,
      lastIndexedAt: body.graph?.lastIndexedAt ?? null,
      state: body.graph?.state ?? "idle",
      completed: body.graph?.completed ?? 0,
      total: body.graph?.total ?? 0,
      error: body.graph?.error ?? null,
    },
  }
}

export function normalizeRuntimeFlagState(body: RuntimeFlagPayload) {
  return body.enabled
}

export function normalizeIsolationState(body: IsolationPayload) {
  return {
    mode: body.mode,
    network: body.network,
  }
}

export function emptyWorkflowDashboardState(): WorkflowDashboardState {
  return {
    runs: [],
    activeCount: 0,
    blockedCount: 0,
    terminalCount: 0,
    verificationEnvelopeCount: 0,
    evidenceRefCount: 0,
    exposedArtifactCount: 0,
  }
}

export function normalizeWorkflowDashboardState(body: WorkflowDashboardPayload): WorkflowDashboardState {
  const runs = (Array.isArray(body) ? body : (body.runs ?? [])).filter(isWorkflowDashboardRun)
  const sorted = [...runs].sort(
    (a, b) => workflowRunSortBucket(a) - workflowRunSortBucket(b) || b.elapsedMs - a.elapsedMs,
  )

  return {
    runs: sorted,
    activeCount: sorted.filter((run) => isActiveWorkflowRunStatus(run.status)).length,
    blockedCount: sorted.filter((run) => run.status === "blocked").length,
    terminalCount: sorted.filter((run) => isTerminalWorkflowRunStatus(run.status)).length,
    verificationEnvelopeCount: sorted.reduce((total, run) => total + run.verificationEnvelopeCount, 0),
    evidenceRefCount: sorted.reduce((total, run) => total + run.evidenceRefCount, 0),
    exposedArtifactCount: sorted.reduce((total, run) => total + run.exposedArtifactCount, 0),
  }
}

function isWorkflowDashboardRun(input: unknown): input is WorkflowDashboardRun {
  if (!input || typeof input !== "object") return false
  const record = input as Partial<WorkflowDashboardRun>
  return typeof record.runID === "string" && typeof record.name === "string" && typeof record.status === "string"
}

function workflowRunSortBucket(run: WorkflowDashboardRun) {
  if (run.status === "blocked") return 0
  if (run.status === "running") return 1
  if (run.status === "queued" || run.status === "paused") return 2
  if (run.status === "failed" || run.status === "cancelled") return 3
  return 4
}

function isActiveWorkflowRunStatus(status: WorkflowDashboardRun["status"]) {
  return status === "queued" || status === "running" || status === "blocked" || status === "paused"
}

function isTerminalWorkflowRunStatus(status: WorkflowDashboardRun["status"]) {
  return status === "completed" || status === "failed" || status === "cancelled"
}
