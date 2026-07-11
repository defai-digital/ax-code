import type { LspStatus, McpStatus } from "@ax-code/sdk/v2"
import { reconcile, type SetStoreFunction } from "solid-js/store"
import {
  createRuntimeSyncActions,
  type RuntimeSyncActions,
  type RuntimeSyncClient,
  type RuntimeSyncFetchResponse,
  type RuntimeSyncLazy,
} from "./sync-runtime-sync"
import { type SyncStoreState } from "./sync-state"

type RuntimeStoreState = Pick<
  SyncStoreState,
  | "workspaceList"
  | "mcp"
  | "lsp"
  | "debugEngine"
  | "workflowDashboard"
  | "autonomous"
  | "smartLlm"
  | "superLong"
  | "isolation"
>

export function createStoreBackedRuntimeSyncActions<TStore extends RuntimeStoreState>(input: {
  url: string
  directory?: RuntimeSyncLazy<string | undefined>
  fetch: (url: string, init?: RequestInit) => Promise<RuntimeSyncFetchResponse>
  client: RuntimeSyncLazy<RuntimeSyncClient>
  debugEngineEnabled: boolean
  workflowRuntimeEnabled?: boolean
  setStore: SetStoreFunction<TStore>
}): RuntimeSyncActions {
  const setStore = input.setStore as unknown as SetStoreFunction<RuntimeStoreState>
  const applyBooleanFeature = (key: "autonomous" | "smartLlm" | "superLong") => (value: boolean) => {
    setStore(key, value)
  }

  return createRuntimeSyncActions({
    url: input.url,
    directory: input.directory,
    fetch: input.fetch,
    client: input.client,
    debugEngineEnabled: input.debugEngineEnabled,
    workflowRuntimeEnabled: input.workflowRuntimeEnabled,
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
    applyWorkflowDashboard(value: RuntimeStoreState["workflowDashboard"]) {
      setStore("workflowDashboard", reconcile(value))
    },
    applyAutonomous: applyBooleanFeature("autonomous"),
    applySmartLlm: applyBooleanFeature("smartLlm"),
    applySuperLong: applyBooleanFeature("superLong"),
    applyIsolation(value: RuntimeStoreState["isolation"]) {
      setStore("isolation", reconcile(value))
    },
  })
}
