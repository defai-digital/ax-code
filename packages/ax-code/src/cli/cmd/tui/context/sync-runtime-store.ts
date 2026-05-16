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
