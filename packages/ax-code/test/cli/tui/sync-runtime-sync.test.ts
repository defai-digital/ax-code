import { describe, expect, test } from "bun:test"
import { createRuntimeSyncActions, type RuntimeSyncClient, type RuntimeSyncFetchResponse } from "../../../src/cli/cmd/tui/context/sync-runtime-sync"

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
        worktree: { list: async () => ({ data: ["repo-a", "repo-b"] }) },
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
      applyIsolation: () => undefined,
    })

    await actions.syncAutonomous()
    await actions.syncSmartLlm()

    expect(requests).toEqual([
      "http://localhost/autonomous",
      "http://localhost/smart-llm",
    ])
    expect(applied).toEqual({
      autonomous: [true],
      smartLlm: [false],
    })
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
