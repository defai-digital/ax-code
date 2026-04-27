import type { LspStatus, McpStatus } from "@ax-code/sdk/v2"
import { reconcile, type SetStoreFunction } from "solid-js/store"
import {
  createRuntimeSyncActions,
  type RuntimeSyncActions,
  type RuntimeSyncClient,
  type RuntimeSyncFetchResponse,
} from "./sync-runtime-sync"
import { type SyncStoreState } from "./sync-state"

type RuntimeStoreState = Pick<
  SyncStoreState,
  "workspaceList" | "mcp" | "lsp" | "debugEngine" | "autonomous" | "smartLlm" | "isolation"
>

export function createStoreBackedRuntimeSyncActions<TStore extends RuntimeStoreState>(input: {
  url: string
  directory?: string
  fetch: (url: string, init?: RequestInit) => Promise<RuntimeSyncFetchResponse>
  client: RuntimeSyncClient
  debugEngineEnabled: boolean
  setStore: SetStoreFunction<TStore>
}): RuntimeSyncActions {
  const setStore = input.setStore as unknown as SetStoreFunction<RuntimeStoreState>

  return createRuntimeSyncActions({
    url: input.url,
    directory: input.directory,
    fetch: input.fetch,
    client: input.client,
    debugEngineEnabled: input.debugEngineEnabled,
    applyWorkspaceList(value) {
      setStore("workspaceList", reconcile(value))
    },
    applyMcp(value: Record<string, McpStatus>) {
      setStore("mcp", reconcile(value))
    },
    applyLsp(value: LspStatus[]) {
      setStore("lsp", value)
    },
    applyDebugEngine(value: RuntimeStoreState["debugEngine"]) {
      setStore("debugEngine", reconcile(value))
    },
    applyAutonomous(value: boolean) {
      setStore("autonomous", value)
    },
    applySmartLlm(value: boolean) {
      setStore("smartLlm", value)
    },
    applyIsolation(value: RuntimeStoreState["isolation"]) {
      setStore("isolation", reconcile(value))
    },
  })
}
