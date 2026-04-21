import type { LspStatus, McpStatus } from "@ax-code/sdk/v2"
import { directoryRequestHeaders } from "../util/request-headers"
import {
  normalizeDebugEngineState,
  normalizeIsolationState,
  normalizeRuntimeFlagState,
  type DebugEnginePayload,
  type IsolationPayload,
  type RuntimeFlagPayload,
} from "./sync-runtime-store"

export interface RuntimeSyncResponse<T> {
  data: T | undefined
}

export interface RuntimeSyncClient {
  worktree: {
    list: () => Promise<RuntimeSyncResponse<string[]>>
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
  syncAutonomous: () => Promise<void>
  syncSmartLlm: () => Promise<void>
  syncIsolation: () => Promise<void>
}

export function createRuntimeSyncActions(input: {
  url: string
  directory?: string
  fetch: (url: string, init?: RequestInit) => Promise<RuntimeSyncFetchResponse>
  client: RuntimeSyncClient
  debugEngineEnabled: boolean
  applyWorkspaceList: (value: string[]) => void
  applyMcp: (value: Record<string, McpStatus>) => void
  applyLsp: (value: LspStatus[]) => void
  applyDebugEngine: (value: ReturnType<typeof normalizeDebugEngineState>) => void
  applyAutonomous: (value: boolean) => void
  applySmartLlm: (value: boolean) => void
  applyIsolation: (value: ReturnType<typeof normalizeIsolationState>) => void
}): RuntimeSyncActions {
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

  return {
    async syncWorkspaces() {
      const result = await input.client.worktree.list().catch(() => undefined)
      if (!result?.data) return
      input.applyWorkspaceList(result.data)
    },
    async syncMcpStatus() {
      const result = await input.client.mcp.status().catch(() => undefined)
      if (!result?.data) return
      input.applyMcp(result.data)
    },
    async syncLspStatus() {
      const result = await input.client.lsp.status().catch(() => undefined)
      if (!result?.data) return
      input.applyLsp(result.data)
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
    async syncAutonomous() {
      await syncRuntimeFlag("/autonomous", input.applyAutonomous)
    },
    async syncSmartLlm() {
      await syncRuntimeFlag("/smart-llm", input.applySmartLlm)
    },
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
