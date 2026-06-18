import type { WorkflowRunProjection } from "@/workflow/projection"
import { isRecord } from "@/util/record"

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

type DebugEngineGraphState = NonNullable<NonNullable<DebugEnginePayload["graph"]>["state"]>

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function nullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function isDebugEnginePlan(input: unknown): input is DebugEnginePlan {
  if (!isRecord(input)) return false
  return (
    typeof input.planId === "string" &&
    typeof input.kind === "string" &&
    typeof input.risk === "string" &&
    typeof input.summary === "string" &&
    typeof input.affectedFileCount === "number" &&
    typeof input.affectedSymbolCount === "number" &&
    typeof input.timeCreated === "number"
  )
}

export function normalizeDebugEngineState(body: unknown) {
  const record = isRecord(body) ? body : {}
  const plans = Array.isArray(record.plans) ? record.plans.filter(isDebugEnginePlan) : []
  const graph = isRecord(record.graph) ? record.graph : {}
  const state: DebugEngineGraphState = graph.state === "indexing" || graph.state === "failed" ? graph.state : "idle"
  const error = typeof graph.error === "string" ? graph.error : null
  return {
    pendingPlans: finiteNumber(record.count, plans.length),
    plans,
    toolCount: finiteNumber(record.toolCount, 0),
    graph: {
      nodeCount: finiteNumber(graph.nodeCount, 0),
      edgeCount: finiteNumber(graph.edgeCount, 0),
      lastIndexedAt: nullableNumber(graph.lastIndexedAt),
      state,
      completed: finiteNumber(graph.completed, 0),
      total: finiteNumber(graph.total, 0),
      error,
    },
  }
}

export function normalizeRuntimeFlagState(body: unknown) {
  return isRecord(body) && body.enabled === true
}

export function normalizeIsolationState(body: unknown) {
  const record = isRecord(body) ? body : {}
  const mode: IsolationPayload["mode"] =
    record.mode === "read-only" || record.mode === "workspace-write" || record.mode === "full-access"
      ? record.mode
      : "workspace-write"
  return {
    mode,
    network: record.network === true,
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

export function normalizeWorkflowDashboardState(body: unknown): WorkflowDashboardState {
  const record = isRecord(body) ? body : {}
  const runs = (Array.isArray(body) ? body : Array.isArray(record.runs) ? record.runs : []).filter(
    isWorkflowDashboardRun,
  )
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
