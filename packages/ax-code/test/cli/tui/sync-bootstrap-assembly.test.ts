import { describe, expect, test } from "bun:test"
import { createStore } from "solid-js/store"
import {
  createStoreBackedBootstrapTasks,
  type SyncBootstrapAssemblyRequests,
  type SyncBootstrapAssemblyStoreState,
} from "../../../src/cli/cmd/tui/context/sync-bootstrap-assembly"

function createState() {
  return createStore<SyncBootstrapAssemblyStoreState>({
    provider: [],
    provider_loaded: false,
    provider_failed: false,
    provider_default: {},
    provider_next: { all: [], default: {}, connected: [] },
    provider_auth: {},
    agent: [],
    command: [],
    permission: {},
    question: {},
    config: {},
    session: [],
    session_status: {},
    lsp: [],
    mcp: {},
    mcp_resource: {},
    formatter: [],
    vcs: undefined,
    path: { state: "", config: "", worktree: "", directory: "" },
  })
}

function createRequests(overrides: Partial<SyncBootstrapAssemblyRequests> = {}): SyncBootstrapAssemblyRequests {
  return {
    sessionListPromise: async () => [],
    providersPromise: async () => ({ data: { providers: [], default: {} } }),
    providerListPromise: async () => ({ data: { all: [], default: {}, connected: [] } }),
    agentsPromise: async () => ({ data: [] }),
    configPromise: async () => ({ data: {} }),
    commandPromise: async () => ({ data: [] }),
    permissionPromise: async () => ({ data: [] }),
    questionPromise: async () => ({ data: [] }),
    sessionStatusPromise: async () => ({ data: {} }),
    providerAuthPromise: async () => ({ data: {} }),
    pathPromise: async () => ({ data: { state: "", config: "", worktree: "", directory: "" } }),
    isolationTask: async () => undefined,
    autonomousTask: async () => undefined,
    lspPromise: async () => ({ data: [] }),
    mcpPromise: async () => ({ data: {} }),
    resourcePromise: async () => ({ data: {} }),
    formatterPromise: async () => ({ data: [] }),
    vcsPromise: async () => ({ data: undefined }),
    workspacesTask: async () => undefined,
    debugEngineTask: async () => undefined,
    smartLlmTask: async () => undefined,
    ...overrides,
  }
}

describe("tui sync bootstrap assembly", () => {
  test("routes session bootstrap work into the blocking phase in continue mode and applies merged sessions", async () => {
    const [store, setStore] = createState()
    setStore("session", [{ id: "ses_2" } as never])

    const tasks = createStoreBackedBootstrapTasks({
      continueFromArgs: true,
      store,
      setStore,
      requests: createRequests({
        sessionListPromise: async () => [{ id: "ses_1" } as never],
      }),
    })

    expect(tasks.blockingTasks).toHaveLength(1)

    await tasks.blockingTasks[0]()

    expect(store.session.map((session) => session.id)).toEqual(["ses_1", "ses_2"])
  })

  test("applies core and deferred bootstrap tasks into the backing store", async () => {
    const [store, setStore] = createState()
    const calls: string[] = []
    const ready: boolean[] = []

    const tasks = createStoreBackedBootstrapTasks({
      continueFromArgs: false,
      store,
      setStore,
      requests: createRequests({
        sessionListPromise: async () => [{ id: "ses_1" } as never],
        providersPromise: async () => ({
          data: { providers: [{ id: "openai" } as never], default: { chat: "openai" } },
        }),
        providerListPromise: async () => ({
          data: { all: [{ id: "openai" } as never], default: { chat: "openai" }, connected: [] },
        }),
        agentsPromise: async () => ({ data: [{ id: "agent_1" } as never] }),
        configPromise: async () => ({ data: { theme: "dark" } as never }),
        commandPromise: async () => ({ data: [{ id: "cmd_1" } as never] }),
        permissionPromise: async () =>
          ({
            data: [{ id: "perm_1", sessionID: "ses_1", permission: "shell", patterns: [], metadata: {}, always: [] }],
          }) as never,
        questionPromise: async () =>
          ({
            data: [{ id: "question_1", sessionID: "ses_1", questions: [], metadata: {} }],
          }) as never,
        sessionStatusPromise: async () => ({ data: { ses_1: "working" as never } }),
        providerAuthPromise: async () => ({ data: { openai: [{ type: "api", label: "API key" } as never] } }),
        pathPromise: async () => ({
          data: { state: "/state", config: "/config", worktree: "/worktree", directory: "/repo" },
        }),
        isolationTask: async () => {
          calls.push("isolation")
        },
        autonomousTask: async () => {
          calls.push("autonomous")
        },
        lspPromise: async () => ({ data: [{ root: "/repo" } as never] }),
        mcpPromise: async () => ({ data: { server: { connected: true } as never } }),
        resourcePromise: async () => ({ data: { resource: { uri: "app://resource" } as never } }),
        formatterPromise: async () => ({ data: [{ name: "prettier" } as never] }),
        vcsPromise: async () => ({ data: { branch: "main" } }),
        workspacesTask: async () => {
          calls.push("workspaces")
        },
        debugEngineTask: async () => {
          calls.push("debug")
        },
        smartLlmTask: async () => {
          calls.push("smart")
        },
      }),
      onProvidersReady(failed) {
        ready.push(failed)
      },
    })

    await Promise.all([...tasks.coreTasks, ...tasks.deferredTasks].map((task) => task()))

    expect(ready).toEqual([false])
    expect(calls.sort()).toEqual(["autonomous", "debug", "isolation", "smart", "workspaces"])
    expect(store.provider.map((provider) => provider.id)).toEqual(["openai"])
    expect(store.provider_default).toEqual({ chat: "openai" })
    expect(store.provider_loaded).toBe(true)
    expect(store.provider_failed).toBe(false)
    expect(store.provider_next.default).toEqual({ chat: "openai" })
    expect(store.provider_next.all).toHaveLength(1)
    expect(store.agent).toHaveLength(1)
    expect((store.config as Record<string, unknown>).theme).toBe("dark")
    expect(store.command).toHaveLength(1)
    expect(store.session.map((session) => session.id)).toEqual(["ses_1"])
    expect(store.permission.ses_1).toHaveLength(1)
    expect(store.question.ses_1).toHaveLength(1)
    expect(store.session_status.ses_1 as unknown).toBe("working")
    expect(store.provider_auth.openai).toHaveLength(1)
    expect(store.path).toEqual({ state: "/state", config: "/config", worktree: "/worktree", directory: "/repo" })
    expect(store.lsp).toHaveLength(1)
    expect(store.mcp).toHaveProperty("server")
    expect(store.mcp_resource).toHaveProperty("resource")
    expect(store.formatter).toHaveLength(1)
    expect(store.vcs).toEqual({ branch: "main" })
  })
})
