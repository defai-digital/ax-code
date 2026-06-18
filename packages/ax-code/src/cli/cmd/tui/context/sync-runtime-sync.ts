import type { LspStatus, McpStatus } from "@ax-code/sdk/v2"
import { directoryRequestHeaders } from "../util/request-headers"
import {
  normalizeDebugEngineState,
  normalizeIsolationState,
  normalizeLspStatusState,
  normalizeMcpStatusState,
  normalizeRuntimeFlagState,
  normalizeWorkflowDashboardState,
  type DebugEnginePayload,
  type IsolationPayload,
  type RuntimeFlagPayload,
  type WorkflowDashboardPayload,
} from "./sync-runtime-store"

export interface RuntimeSyncResponse<T> {
  data: T | undefined
}

export type RuntimeSyncWorktree = string | { directory?: unknown }

export interface RuntimeSyncClient {
  worktree: {
    list: () => Promise<RuntimeSyncResponse<RuntimeSyncWorktree[]>>
  }
  mcp: {
    status: () => Promise<RuntimeSyncResponse<Record<string, McpStatus>>>
  }
  lsp: {
    status: () => Promise<RuntimeSyncResponse<LspStatus[]>>
  }
}

export interface RuntimeSyncFetchResponse {
  ok: boolean
  json: () => Promise<unknown>
}

export interface RuntimeSyncActions {
  syncWorkspaces: () => Promise<void>
  syncMcpStatus: () => Promise<void>
  syncLspStatus: () => Promise<void>
  syncDebugEngine: () => Promise<void>
  syncWorkflowDashboard: () => Promise<void>
  syncAutonomous: () => Promise<void>
  syncSmartLlm: () => Promise<void>
  syncSuperLong: (input?: { model?: string }) => Promise<void>
  syncIsolation: () => Promise<void>
}

export function createRuntimeSyncActions(input: {
  url: string
  directory?: string
  fetch: (url: string, init?: RequestInit) => Promise<RuntimeSyncFetchResponse>
  client: RuntimeSyncClient
  debugEngineEnabled: boolean
  workflowRuntimeEnabled?: boolean
  applyWorkspaceList: (value: string[]) => void
  applyMcp: (value: Record<string, McpStatus>) => void
  applyLsp: (value: LspStatus[]) => void
  applyDebugEngine: (value: ReturnType<typeof normalizeDebugEngineState>) => void
  applyWorkflowDashboard?: (value: ReturnType<typeof normalizeWorkflowDashboardState>) => void
  applyAutonomous: (value: boolean) => void
  applySmartLlm: (value: boolean) => void
  applySuperLong: (value: boolean) => void
  applyIsolation: (value: ReturnType<typeof normalizeIsolationState>) => void
}): RuntimeSyncActions {
  function normalizeWorkspaceList(input: RuntimeSyncWorktree[]) {
    return input.flatMap((item) => {
      if (typeof item === "string" && item.trim().length > 0) return [item]
      if (
        item &&
        typeof item === "object" &&
        typeof item.directory === "string" &&
        item.directory.trim().length > 0
      ) {
        return [item.directory]
      }
      return []
    })
  }

  async function fetchOptionalRuntimeJson<T>(pathname: string, init?: RequestInit) {
    try {
      const path = pathname.startsWith("/") ? pathname : `/${pathname}`
      const response = await input.fetch(`${input.url}${path}`, init)
      if (!response.ok) return
      return (await response.json()) as T
    } catch {
      return
    }
  }

  async function syncRuntimeFlag(pathname: string, apply: (value: boolean) => void) {
    const body = await fetchOptionalRuntimeJson<RuntimeFlagPayload>(pathname)
    if (!body) return
    apply(normalizeRuntimeFlagState(body))
  }

  function createRuntimeFeatureSync(pathname: string, apply: (value: boolean) => void) {
    return () => syncRuntimeFlag(pathname, apply)
  }

  function superLongPath(input?: { model?: string }) {
    if (!input?.model) return "/super-long"
    const params = new URLSearchParams({ model: input.model })
    return `/super-long?${params.toString()}`
  }

  function workflowDashboardPath() {
    const params = new URLSearchParams({ limit: "8" })
    return `/workflow-runs/dashboard?${params.toString()}`
  }

  return {
    async syncWorkspaces() {
      const result = await input.client.worktree.list().catch(() => undefined)
      if (!result?.data) return
      input.applyWorkspaceList(normalizeWorkspaceList(result.data))
    },
    async syncMcpStatus() {
      const result = await input.client.mcp.status().catch(() => undefined)
      if (!result?.data) return
      input.applyMcp(normalizeMcpStatusState(result.data) as Record<string, McpStatus>)
    },
    async syncLspStatus() {
      const result = await input.client.lsp.status().catch(() => undefined)
      if (!result?.data) return
      input.applyLsp(normalizeLspStatusState<LspStatus>(result.data))
    },
    async syncDebugEngine() {
      if (!input.debugEngineEnabled) return
      const body = await fetchOptionalRuntimeJson<DebugEnginePayload>("/debug-engine/pending-plans", {
        headers: directoryRequestHeaders({
          directory: input.directory,
          accept: "application/json",
        }),
      })
      if (!body) return
      input.applyDebugEngine(normalizeDebugEngineState(body))
    },
    async syncWorkflowDashboard() {
      if (!input.workflowRuntimeEnabled || !input.applyWorkflowDashboard) return
      const body = await fetchOptionalRuntimeJson<WorkflowDashboardPayload>(workflowDashboardPath(), {
        headers: directoryRequestHeaders({
          directory: input.directory,
          accept: "application/json",
        }),
      })
      if (!body) return
      input.applyWorkflowDashboard(normalizeWorkflowDashboardState(body))
    },
    syncAutonomous: createRuntimeFeatureSync("/autonomous", input.applyAutonomous),
    syncSmartLlm: createRuntimeFeatureSync("/smart-llm", input.applySmartLlm),
    syncSuperLong: (superLongInput) => syncRuntimeFlag(superLongPath(superLongInput), input.applySuperLong),
    async syncIsolation() {
      const body = await fetchOptionalRuntimeJson<IsolationPayload>("/isolation", {
        headers: directoryRequestHeaders({
          directory: input.directory,
          accept: "application/json",
        }),
      })
      if (!body) return
      input.applyIsolation(normalizeIsolationState(body))
    },
  }
}
