import { describe, expect, test } from "bun:test"
import {
  createRuntimeSyncActions,
  type RuntimeSyncClient,
  type RuntimeSyncFetchResponse,
} from "../../../src/cli/cmd/tui/context/sync-runtime-sync"
import type { WorkflowDashboardState } from "../../../src/cli/cmd/tui/context/sync-runtime-store"

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

describe("tui sync runtime sync", () => {
  test("applies workspace, mcp, and lsp client data when present", async () => {
    const applied = {
      workspaces: [] as string[][],
      mcp: [] as Array<Record<string, unknown>>,
      lsp: [] as unknown[][],
    }

    const actions = createRuntimeSyncActions({
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
      applyWorkspaceList(value) {
        applied.workspaces.push(value)
      },
      applyMcp(value) {
        applied.mcp.push(value)
      },
      applyLsp(value) {
        applied.lsp.push(value as unknown[])
      },
      applyDebugEngine: () => undefined,
      applyAutonomous: () => undefined,
      applySmartLlm: () => undefined,
      applySuperLong: () => undefined,
      applyIsolation: () => undefined,
    })

    await actions.syncWorkspaces()
    await actions.syncMcpStatus()
    await actions.syncLspStatus()

    expect(applied).toEqual({
      workspaces: [["repo-a", "repo-b"]],
      mcp: [{ server: { connected: true } }],
      lsp: [[{ root: "/repo", healthy: true }]],
    })
  })

  test("skips debug-engine fetches when the feature is disabled", async () => {
    const fetchCalls: string[] = []

    const actions = createRuntimeSyncActions({
      url: "http://localhost",
      fetch: async (url) => {
        fetchCalls.push(url)
        return okJson({})
      },
      client: createClient(),
      debugEngineEnabled: false,
      applyWorkspaceList: () => undefined,
      applyMcp: () => undefined,
      applyLsp: () => undefined,
      applyDebugEngine: () => undefined,
      applyAutonomous: () => undefined,
      applySmartLlm: () => undefined,
      applySuperLong: () => undefined,
      applyIsolation: () => undefined,
    })

    await actions.syncDebugEngine()

    expect(fetchCalls).toEqual([])
  })

  test("fetches debug-engine state with directory headers and applies normalized values", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const applied: Array<Record<string, unknown>> = []

    const actions = createRuntimeSyncActions({
      url: "http://localhost",
      directory: "/repo",
      fetch: async (url, init) => {
        requests.push({ url, init })
        return okJson({
          count: 1,
          plans: [],
          toolCount: 2,
          graph: { nodeCount: 3, edgeCount: 4, lastIndexedAt: 5 },
        })
      },
      client: createClient(),
      debugEngineEnabled: true,
      applyWorkspaceList: () => undefined,
      applyMcp: () => undefined,
      applyLsp: () => undefined,
      applyDebugEngine(value) {
        applied.push(value)
      },
      applyAutonomous: () => undefined,
      applySmartLlm: () => undefined,
      applySuperLong: () => undefined,
      applyIsolation: () => undefined,
    })

    await actions.syncDebugEngine()

    expect(requests).toEqual([
      {
        url: "http://localhost/debug-engine/pending-plans",
        init: {
          headers: {
            accept: "application/json",
            "x-ax-code-directory": "/repo",
            "x-opencode-directory": "/repo",
          },
        },
      },
    ])
    expect(applied).toEqual([
      {
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
      },
    ])
  })

  test("fetches workflow dashboard state with directory headers when enabled", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const applied: WorkflowDashboardState[] = []

    const actions = createRuntimeSyncActions({
      url: "http://localhost",
      directory: "/repo",
      fetch: async (url, init) => {
        requests.push({ url, init })
        return okJson([workflowRun({ runID: "workflow_run_01", status: "running" })])
      },
      client: createClient(),
      debugEngineEnabled: true,
      workflowRuntimeEnabled: true,
      applyWorkspaceList: () => undefined,
      applyMcp: () => undefined,
      applyLsp: () => undefined,
      applyDebugEngine: () => undefined,
      applyWorkflowDashboard(value) {
        applied.push(value)
      },
      applyAutonomous: () => undefined,
      applySmartLlm: () => undefined,
      applySuperLong: () => undefined,
      applyIsolation: () => undefined,
    })

    await actions.syncWorkflowDashboard()

    expect(requests).toEqual([
      {
        url: "http://localhost/workflow-runs/dashboard?limit=8",
        init: {
          headers: {
            accept: "application/json",
            "x-ax-code-directory": "/repo",
            "x-opencode-directory": "/repo",
          },
        },
      },
    ])
    expect(applied).toMatchObject([
      {
        runs: [{ runID: "workflow_run_01", status: "running" }],
        activeCount: 1,
      },
    ])
  })

  test("skips workflow dashboard fetches when the workflow runtime is disabled", async () => {
    const fetchCalls: string[] = []

    const actions = createRuntimeSyncActions({
      url: "http://localhost",
      fetch: async (url) => {
        fetchCalls.push(url)
        return okJson([])
      },
      client: createClient(),
      debugEngineEnabled: true,
      workflowRuntimeEnabled: false,
      applyWorkspaceList: () => undefined,
      applyMcp: () => undefined,
      applyLsp: () => undefined,
      applyDebugEngine: () => undefined,
      applyWorkflowDashboard: () => undefined,
      applyAutonomous: () => undefined,
      applySmartLlm: () => undefined,
      applySuperLong: () => undefined,
      applyIsolation: () => undefined,
    })

    await actions.syncWorkflowDashboard()

    expect(fetchCalls).toEqual([])
  })

  test("applies autonomous and smart-llm runtime flags from optional runtime endpoints", async () => {
    const requests: string[] = []
    const applied = {
      autonomous: [] as boolean[],
      smartLlm: [] as boolean[],
    }

    const fetchQueue = [okJson({ enabled: true }), okJson({ enabled: false })]
    const actions = createRuntimeSyncActions({
      url: "http://localhost",
      fetch: async (url) => {
        requests.push(url)
        return fetchQueue.shift() ?? okJson({})
      },
      client: createClient(),
      debugEngineEnabled: true,
      applyWorkspaceList: () => undefined,
      applyMcp: () => undefined,
      applyLsp: () => undefined,
      applyDebugEngine: () => undefined,
      applyAutonomous(value) {
        applied.autonomous.push(value)
      },
      applySmartLlm(value) {
        applied.smartLlm.push(value)
      },
      applySuperLong: () => undefined,
      applyIsolation: () => undefined,
    })

    await actions.syncAutonomous()
    await actions.syncSmartLlm()

    expect(requests).toEqual(["http://localhost/autonomous", "http://localhost/smart-llm"])
    expect(applied).toEqual({
      autonomous: [true],
      smartLlm: [false],
    })
  })

  test("syncs super-long against an explicit active model", async () => {
    const requests: string[] = []
    const applied: boolean[] = []

    const actions = createRuntimeSyncActions({
      url: "http://localhost",
      fetch: async (url) => {
        requests.push(url)
        return okJson({ enabled: true })
      },
      client: createClient(),
      debugEngineEnabled: true,
      applyWorkspaceList: () => undefined,
      applyMcp: () => undefined,
      applyLsp: () => undefined,
      applyDebugEngine: () => undefined,
      applyAutonomous: () => undefined,
      applySmartLlm: () => undefined,
      applySuperLong(value) {
        applied.push(value)
      },
      applyIsolation: () => undefined,
    })

    await actions.syncSuperLong({ model: "alibaba-coding-plan/qwen3.7-max" })

    expect(requests).toEqual(["http://localhost/super-long?model=alibaba-coding-plan%2Fqwen3.7-max"])
    expect(applied).toEqual([true])
  })

  test("applies isolation payloads and swallows failed optional runtime fetches", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const applied: Array<Record<string, unknown>> = []
    let failNext = false

    const actions = createRuntimeSyncActions({
      url: "http://localhost",
      directory: "/repo",
      fetch: async (url, init) => {
        requests.push({ url, init })
        if (failNext) throw new Error("network failed")
        return okJson({ mode: "workspace-write", network: true })
      },
      client: createClient(),
      debugEngineEnabled: true,
      applyWorkspaceList: () => undefined,
      applyMcp: () => undefined,
      applyLsp: () => undefined,
      applyDebugEngine: () => undefined,
      applyAutonomous: () => undefined,
      applySmartLlm: () => undefined,
      applySuperLong: () => undefined,
      applyIsolation(value) {
        applied.push(value)
      },
    })

    await actions.syncIsolation()
    failNext = true
    await actions.syncIsolation()

    expect(requests).toEqual([
      {
        url: "http://localhost/isolation",
        init: {
          headers: {
            accept: "application/json",
            "x-ax-code-directory": "/repo",
            "x-opencode-directory": "/repo",
          },
        },
      },
      {
        url: "http://localhost/isolation",
        init: {
          headers: {
            accept: "application/json",
            "x-ax-code-directory": "/repo",
            "x-opencode-directory": "/repo",
          },
        },
      },
    ])
    expect(applied).toEqual([{ mode: "workspace-write", network: true }])
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
