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

// The active workspace can change at runtime: sdk.setWorkspace() swaps the
// client and the directory it scopes requests to. Callers may therefore pass a
// live accessor instead of a one-time snapshot, resolved on every request so
// runtime status always reflects the session currently being viewed.
export type RuntimeSyncLazy<T> = T | (() => T)
function resolveRuntimeSyncLazy<T>(value: RuntimeSyncLazy<T>): T {
  return typeof value === "function" ? (value as () => T)() : value
}

export function createRuntimeSyncActions(input: {
  url: string
  directory?: RuntimeSyncLazy<string | undefined>
  fetch: (url: string, init?: RequestInit) => Promise<RuntimeSyncFetchResponse>
  client: RuntimeSyncLazy<RuntimeSyncClient>
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
  const currentClient = () => resolveRuntimeSyncLazy(input.client)
  const currentDirectory = () => resolveRuntimeSyncLazy(input.directory)

  const latestRequests = new Map<keyof RuntimeSyncActions, object>()
  function beginRequest(kind: keyof RuntimeSyncActions) {
    const client = currentClient()
    const token = {}
    latestRequests.set(kind, token)
    return {
      client,
      // A slow pre-disconnect response must not overwrite a newer refresh,
      // even when reconnection retains the same workspace/client object.
      isCurrent: () => currentClient() === client && latestRequests.get(kind) === token,
    }
  }

  function normalizeWorkspaceList(input: unknown) {
    if (!Array.isArray(input)) return []
    return input.flatMap((item: RuntimeSyncWorktree | null) => {
      if (typeof item === "string" && item.trim().length > 0) return [item]
      if (item && typeof item === "object" && typeof item.directory === "string" && item.directory.trim().length > 0) {
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

  async function syncRuntimeFlag(kind: keyof RuntimeSyncActions, pathname: string, apply: (value: boolean) => void) {
    // Scope the read to the active directory like syncIsolation; without the
    // header the server reads its own cwd's ax-code.json.
    const request = beginRequest(kind)
    const body = await fetchOptionalRuntimeJson<RuntimeFlagPayload>(pathname, {
      headers: directoryRequestHeaders({
        directory: currentDirectory(),
        accept: "application/json",
      }),
    })
    if (!body) return
    if (!request.isCurrent()) return
    apply(normalizeRuntimeFlagState(body))
  }

  function createRuntimeFeatureSync(kind: keyof RuntimeSyncActions, pathname: string, apply: (value: boolean) => void) {
    return () => syncRuntimeFlag(kind, pathname, apply)
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
      const request = beginRequest("syncWorkspaces")
      const result = await request.client.worktree.list().catch(() => undefined)
      if (!result?.data) return
      if (!request.isCurrent()) return
      input.applyWorkspaceList(normalizeWorkspaceList(result.data))
    },
    async syncMcpStatus() {
      const request = beginRequest("syncMcpStatus")
      const result = await request.client.mcp.status().catch(() => undefined)
      if (!result?.data) return
      if (!request.isCurrent()) return
      input.applyMcp(normalizeMcpStatusState(result.data) as Record<string, McpStatus>)
    },
    async syncLspStatus() {
      const request = beginRequest("syncLspStatus")
      const result = await request.client.lsp.status().catch(() => undefined)
      if (!result?.data) return
      if (!request.isCurrent()) return
      input.applyLsp(normalizeLspStatusState<LspStatus>(result.data))
    },
    async syncDebugEngine() {
      if (!input.debugEngineEnabled) return
      const request = beginRequest("syncDebugEngine")
      const body = await fetchOptionalRuntimeJson<DebugEnginePayload>("/debug-engine/pending-plans", {
        headers: directoryRequestHeaders({
          directory: currentDirectory(),
          accept: "application/json",
        }),
      })
      if (!body) return
      if (!request.isCurrent()) return
      input.applyDebugEngine(normalizeDebugEngineState(body))
    },
    async syncWorkflowDashboard() {
      if (!input.workflowRuntimeEnabled || !input.applyWorkflowDashboard) return
      const request = beginRequest("syncWorkflowDashboard")
      const body = await fetchOptionalRuntimeJson<WorkflowDashboardPayload>(workflowDashboardPath(), {
        headers: directoryRequestHeaders({
          directory: currentDirectory(),
          accept: "application/json",
        }),
      })
      if (!body) return
      if (!request.isCurrent()) return
      input.applyWorkflowDashboard(normalizeWorkflowDashboardState(body))
    },
    syncAutonomous: createRuntimeFeatureSync("syncAutonomous", "/autonomous", input.applyAutonomous),
    syncSmartLlm: createRuntimeFeatureSync("syncSmartLlm", "/smart-llm", input.applySmartLlm),
    syncSuperLong: (superLongInput) =>
      syncRuntimeFlag("syncSuperLong", superLongPath(superLongInput), input.applySuperLong),
    async syncIsolation() {
      const request = beginRequest("syncIsolation")
      const body = await fetchOptionalRuntimeJson<IsolationPayload>("/isolation", {
        headers: directoryRequestHeaders({
          directory: currentDirectory(),
          accept: "application/json",
        }),
      })
      if (!body) return
      if (!request.isCurrent()) return
      input.applyIsolation(normalizeIsolationState(body))
    },
  }
}
