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
        worktree: {
          list: async () => ({
            data: ["repo-a", { directory: "repo-b", name: "repo-b", branch: "ax-code/repo-b" }],
          }),
        },
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
      okJson([workflowRun({ runID: "workflow_run_01", status: "running" })]),
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
      workflowRuntimeEnabled: true,
      setStore,
    })

    await actions.syncDebugEngine()
    await actions.syncWorkflowDashboard()
    await actions.syncAutonomous()
    await actions.syncSmartLlm()
    await actions.syncIsolation()

    expect(requests).toEqual([
      "http://localhost/debug-engine/pending-plans",
      "http://localhost/workflow-runs/dashboard?limit=8",
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
    expect(store.workflowDashboard.runs).toMatchObject([{ runID: "workflow_run_01", status: "running" }])
    expect(store.workflowDashboard.activeCount).toBe(1)
    expect(store.autonomous).toBe(true)
    expect(store.smartLlm).toBe(false)
    expect(store.isolation).toEqual({ mode: "workspace-write", network: true })
  })
})

function workflowRun(input: {
  runID: string
  status: "queued" | "running" | "blocked" | "paused" | "failed" | "completed" | "cancelled"
}) {
  return {
    runID: input.runID,
    status: input.status,
    name: input.runID,
    elapsedMs: 0,
    effort: "workflow",
    models: {},
    budgetUsage: {
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      toolCalls: 0,
      childAgents: 0,
      retries: 0,
      estimatedCostUsd: 0,
    },
    budgetLimit: {
      maxTotalTokens: 10_000,
      maxInputTokensPerChild: 5_000,
      maxOutputTokensPerChild: 1_000,
      maxWallTimeMs: 600_000,
      maxConcurrentAgents: 3,
      maxTotalAgents: 25,
      maxToolCalls: 100,
      maxRetries: 1,
    },
    phaseCounts: { queued: 0, running: 0, blocked: 0, paused: 0, failed: 0, completed: 0, cancelled: 0 },
    childCounts: {
      queued: 0,
      running: 0,
      blockedPermission: 0,
      blockedQuestion: 0,
      paused: 0,
      failed: 0,
      completed: 0,
      cancelled: 0,
    },
    artifactCounts: { summary: 0, finding: 0, patch: 0, verification: 0, metric: 0, log: 0 },
    verificationEnvelopeCount: 0,
    exposedArtifactCount: 0,
  }
}
