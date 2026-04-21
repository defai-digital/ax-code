import { describe, expect, test } from "bun:test"
import { createStore } from "solid-js/store"
import { createStoreBackedRuntimeSyncActions } from "../../../src/cli/cmd/tui/context/sync-runtime-adapter"
import type { RuntimeSyncClient, RuntimeSyncFetchResponse } from "../../../src/cli/cmd/tui/context/sync-runtime-sync"
import { createInitialSyncState, type SyncStoreState } from "../../../src/cli/cmd/tui/context/sync-state"

function okJson(value: unknown): RuntimeSyncFetchResponse {
  return {
    ok: true,
    json: async () => value,
  }
}

function createClient(input?: Partial<RuntimeSyncClient>): RuntimeSyncClient {
  return {
    worktree: {
      list: async () => ({ data: undefined }),
      ...input?.worktree,
    },
    mcp: {
      status: async () => ({ data: undefined }),
      ...input?.mcp,
    },
    lsp: {
      status: async () => ({ data: undefined }),
      ...input?.lsp,
    },
  }
}

describe("tui sync runtime adapter", () => {
  test("applies workspace, mcp, and lsp client data into the backing store", async () => {
    const [store, setStore] = createStore<SyncStoreState>(createInitialSyncState())

    const actions = createStoreBackedRuntimeSyncActions({
      url: "http://localhost",
      fetch: async () => okJson({}),
      client: createClient({
        worktree: { list: async () => ({ data: ["repo-a", "repo-b"] }) },
        mcp: { status: async () => ({ data: { server: { connected: true } as unknown as never } }) },
        lsp: { status: async () => ({ data: [{ root: "/repo", healthy: true } as unknown as never] }) },
      }),
      debugEngineEnabled: true,
      setStore,
    })

    await actions.syncWorkspaces()
    await actions.syncMcpStatus()
    await actions.syncLspStatus()

    expect(store.workspaceList).toEqual(["repo-a", "repo-b"])
    expect(store.mcp as unknown).toEqual({ server: { connected: true } })
    expect(store.lsp as unknown).toEqual([{ root: "/repo", healthy: true }])
  })

  test("applies debug-engine and runtime flags into the backing store", async () => {
    const [store, setStore] = createStore<SyncStoreState>(createInitialSyncState())
    const requests: string[] = []
    const fetchQueue = [
      okJson({ count: 1, plans: [], toolCount: 2, graph: { nodeCount: 3, edgeCount: 4, lastIndexedAt: 5 } }),
      okJson({ enabled: true }),
      okJson({ enabled: false }),
      okJson({ mode: "workspace-write", network: true }),
    ]

    const actions = createStoreBackedRuntimeSyncActions({
      url: "http://localhost",
      directory: "/repo",
      fetch: async (url) => {
        requests.push(url)
        return fetchQueue.shift() ?? okJson({})
      },
      client: createClient(),
      debugEngineEnabled: true,
      setStore,
    })

    await actions.syncDebugEngine()
    await actions.syncAutonomous()
    await actions.syncSmartLlm()
    await actions.syncIsolation()

    expect(requests).toEqual([
      "http://localhost/debug-engine/pending-plans",
      "http://localhost/autonomous",
      "http://localhost/smart-llm",
      "http://localhost/isolation",
    ])
    expect(store.debugEngine).toEqual({
      pendingPlans: 1,
      plans: [],
      toolCount: 2,
      graph: {
        nodeCount: 3,
        edgeCount: 4,
        lastIndexedAt: 5,
        state: "idle",
        completed: 0,
        total: 0,
        error: null,
      },
    })
    expect(store.autonomous).toBe(true)
    expect(store.smartLlm).toBe(false)
    expect(store.isolation).toEqual({ mode: "workspace-write", network: true })
  })
})
