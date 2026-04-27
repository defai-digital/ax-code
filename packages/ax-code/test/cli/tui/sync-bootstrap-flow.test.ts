import { describe, expect, test } from "bun:test"
import { createStore } from "solid-js/store"
import { createSyncBootstrapFlow } from "../../../src/cli/cmd/tui/context/sync-bootstrap-flow"
import { createStoreBackedBootstrapTasks } from "../../../src/cli/cmd/tui/context/sync-bootstrap-assembly"
import { createInitialSyncState } from "../../../src/cli/cmd/tui/context/sync-state"

function createClient() {
  return {
    app: {
      agents: async () => ({ data: [] }),
    },
    command: {
      list: async () => ({ data: [] }),
    },
    config: {
      get: async () => ({ data: {} }),
      providers: async () => ({ data: { providers: [], default: {} } }),
    },
    experimental: {
      resource: {
        list: async () => ({ data: {} }),
      },
    },
    formatter: {
      status: async () => ({ data: [] }),
    },
    lsp: {
      status: async () => ({ data: [] }),
    },
    mcp: {
      status: async () => ({ data: {} }),
    },
    path: {
      get: async () => ({ data: { state: "", config: "", worktree: "", directory: "" } }),
    },
    permission: {
      list: async () => ({ data: [] }),
    },
    provider: {
      auth: async () => ({ data: {} }),
      list: async () => ({ data: { all: [], default: {}, connected: [] } }),
    },
    question: {
      list: async () => ({ data: [] }),
    },
    session: {
      list: async () => ({ data: [] as Array<{ id: string }> }),
      status: async () => ({ data: {} }),
    },
    vcs: {
      get: async () => ({ data: undefined }),
    },
  } as any
}

describe("tui sync bootstrap flow", () => {
  test("runs the bootstrap orchestration and records startup markers", async () => {
    const [store, setStore] = createStore(createInitialSyncState())
    const startup: Array<{ name: string; data?: Record<string, unknown> }> = []
    const spanPayloads = new Map<string, Array<Record<string, unknown> | undefined>>()
    const statuses: string[] = []
    const sessionLoaded: boolean[] = []
    const runtimeCalls: string[] = []
    let resetCalls = 0

    const flow = createSyncBootstrapFlow({
      store,
      setStatus(status) {
        statuses.push(status)
        setStore("status", status)
      },
      setSessionLoaded(loaded) {
        sessionLoaded.push(loaded)
        setStore("session_loaded", loaded)
      },
      resetSessionSync() {
        resetCalls++
      },
      wrap: async (_label, promise) => promise,
      client: {
        ...createClient(),
        session: {
          list: async () => ({ data: [{ id: "ses_1" }, { id: "ses_2" }] as never }),
          status: async () => ({ data: { ses_1: "working" as never } }),
        },
        config: {
          get: async () => ({ data: { theme: "dark" } as never }),
          providers: async () => ({ data: { providers: [{ id: "openai" } as never], default: { chat: "openai" } } }),
        },
        provider: {
          auth: async () => ({ data: {} }),
          list: async () => ({
            data: { all: [{ id: "openai" } as never], default: { chat: "openai" }, connected: [] },
          }),
        },
      } as never,
      syncIsolation: async () => {
        runtimeCalls.push("isolation")
      },
      syncAutonomous: async () => {
        runtimeCalls.push("autonomous")
      },
      syncWorkspaces: async () => {
        runtimeCalls.push("workspaces")
      },
      syncDebugEngine: async () => {
        runtimeCalls.push("debug")
      },
      syncSmartLlm: async () => {
        runtimeCalls.push("smart")
      },
      createTasks(requests, onProvidersReady) {
        return createStoreBackedBootstrapTasks({
          continueFromArgs: true,
          store,
          setStore,
          requests,
          onProvidersReady,
        })
      },
      createSpan(name) {
        return (data) => {
          const payloads = spanPayloads.get(name) ?? []
          payloads.push(data)
          spanPayloads.set(name, payloads)
        }
      },
      recordStartup(name, data) {
        startup.push({ name, data })
      },
      logWarn: () => undefined,
      logError: () => undefined,
      onFailure: () => undefined,
      now: () => 1_000_000,
    })

    await flow.run()

    expect(resetCalls).toBe(1)
    expect(sessionLoaded).toEqual([false, true])
    expect(statuses).toEqual(["partial", "complete"])
    expect(store.session.map((session) => session.id)).toEqual(["ses_1", "ses_2"])
    expect(store.provider.map((provider) => provider.id)).toEqual(["openai"])
    expect((store.config as Record<string, unknown>).theme).toBe("dark")
    expect(runtimeCalls.sort()).toEqual(["autonomous", "debug", "isolation", "smart", "workspaces"])
    expect(startup).toEqual([
      { name: "tui.startup.sessionListReady", data: undefined },
      { name: "tui.startup.syncPartial", data: undefined },
      { name: "tui.startup.providersReady", data: { failed: false } },
      { name: "tui.startup.bootstrapCoreReady", data: { rejected: 0 } },
      { name: "tui.startup.bootstrapDeferredReady", data: { rejected: 0 } },
    ])
    expect(spanPayloads.get("tui.startup.bootstrap")).toEqual([undefined])
    expect(spanPayloads.get("tui.startup.bootstrapCore")).toEqual([{ rejected: 0 }])
    expect(spanPayloads.get("tui.startup.bootstrapDeferred")).toEqual([{ rejected: 0 }])
  })

  test("routes failures through the bootstrap lifecycle failure handler and rethrows the original error", async () => {
    const [store, setStore] = createStore(createInitialSyncState())
    const failures: string[] = []

    const flow = createSyncBootstrapFlow({
      store,
      setStatus(status) {
        setStore("status", status)
      },
      setSessionLoaded(loaded) {
        setStore("session_loaded", loaded)
      },
      resetSessionSync: () => undefined,
      wrap: async (_label, promise) => promise,
      client: createClient() as never,
      syncIsolation: async () => undefined,
      syncAutonomous: async () => undefined,
      syncWorkspaces: async () => undefined,
      syncDebugEngine: async () => undefined,
      syncSmartLlm: async () => undefined,
      createTasks() {
        throw new Error("bootstrap flow failed")
      },
      createSpan() {
        return () => undefined
      },
      recordStartup: () => undefined,
      logWarn: () => undefined,
      logError: () => undefined,
      async onFailure(error) {
        failures.push(String(error))
      },
    })

    await expect(flow.run()).rejects.toThrow("bootstrap flow failed")
    expect(failures).toEqual(["Error: bootstrap flow failed"])
  })
})
