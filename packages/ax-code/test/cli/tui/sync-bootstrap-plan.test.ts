import { describe, expect, test } from "bun:test"
import {
  createCoreBootstrapPhaseTasks,
  createDeferredBootstrapPhaseTasks,
  createBootstrapResponsePlanTasks,
  createProviderBootstrapTask,
  createSessionBootstrapPhaseTasks,
} from "../../../src/cli/cmd/tui/context/sync-bootstrap-plan"

describe("tui sync bootstrap plan", () => {
  test("routes session bootstrap work to the blocking phase when continue mode is enabled", async () => {
    const applied: Array<Array<{ id: string }>> = []

    const tasks = createSessionBootstrapPhaseTasks({
      continueFromArgs: true,
      sessionListPromise: () => Promise.resolve([{ id: "ses_2" }]),
      existingSessions: [{ id: "ses_1" }],
      applySessions(sessions) {
        applied.push(sessions)
      },
    })

    expect(tasks.core).toEqual([])
    expect(tasks.blocking).toHaveLength(1)

    await tasks.blocking[0]()

    expect(applied).toEqual([[{ id: "ses_1" }, { id: "ses_2" }]])
  })

  test("routes session bootstrap work to the core phase when continue mode is disabled", async () => {
    const applied: Array<Array<{ id: string }>> = []

    const tasks = createSessionBootstrapPhaseTasks({
      continueFromArgs: false,
      sessionListPromise: () => Promise.resolve([{ id: "ses_2" }]),
      existingSessions: [{ id: "ses_3" }],
      applySessions(sessions) {
        applied.push(sessions)
      },
    })

    expect(tasks.blocking).toEqual([])
    expect(tasks.core).toHaveLength(1)

    await tasks.core[0]()

    expect(applied).toEqual([[{ id: "ses_2" }, { id: "ses_3" }]])
  })

  test("applies provider success state and reports readiness", async () => {
    const success: Array<{
      provider_loaded: boolean
      provider_failed: boolean
      provider?: string[]
      provider_default?: Record<string, string>
    }> = []
    const ready: boolean[] = []

    await createProviderBootstrapTask({
      providersPromise: () => Promise.resolve({ data: { providers: ["openai"], default: { chat: "openai" } } }),
      applyState(value) {
        success.push(value)
      },
      onReady(failed) {
        ready.push(failed)
      },
    })()

    expect(success).toEqual([{
      provider: ["openai"],
      provider_default: { chat: "openai" },
      provider_loaded: true,
      provider_failed: false,
    }])
    expect(ready).toEqual([false])
  })

  test("applies provider failure state, reports readiness, and rethrows", async () => {
    const failures: Array<{ provider_loaded: boolean; provider_failed: boolean }> = []
    const ready: boolean[] = []

    await expect(
      createProviderBootstrapTask({
        providersPromise: () => Promise.reject(new Error("provider bootstrap failed")),
        applyState(value) {
          failures.push(value)
        },
        onReady(failed) {
          ready.push(failed)
        },
      })(),
    ).rejects.toThrow("provider bootstrap failed")

    expect(failures).toEqual([{ provider_loaded: true, provider_failed: true }])
    expect(ready).toEqual([true])
  })

  test("materializes heterogeneous response plans through the shared bootstrap helper", async () => {
    const applied: string[] = []

    await Promise.all(createBootstrapResponsePlanTasks(
      {
        request: () => Promise.resolve({ data: ["a", "b"] }),
        normalize: (value) => (value ?? []).join(","),
        apply(value) {
          applied.push(value)
        },
      },
      {
        request: () => Promise.resolve({ data: { count: 2 } }),
        normalize: (value) => String(value?.count ?? 0),
        apply(value) {
          applied.push(value)
        },
      },
    ).map((task) => task()))

    expect(applied).toEqual(["a,b", "2"])
  })

  test("materializes the core bootstrap phase tasks through a single plan helper", async () => {
    const applied: string[] = []

    await Promise.all(createCoreBootstrapPhaseTasks({
      providerTask: () => Promise.resolve().then(() => {
        applied.push("provider-task")
      }),
      providerListPromise: () => Promise.resolve({ data: { all: [], default: {}, connected: [] } }),
      providerNextFallback: { all: [], default: {}, connected: [] },
      applyProviderNext: () => {
        applied.push("provider-next")
      },
      agentsPromise: () => Promise.resolve({ data: [] }),
      applyAgents: () => {
        applied.push("agents")
      },
      configPromise: () => Promise.resolve({ data: {} }),
      configFallback: {},
      applyConfig: () => {
        applied.push("config")
      },
      commandPromise: () => Promise.resolve({ data: [] }),
      applyCommands: () => {
        applied.push("command")
      },
      sessionTasks: [() => Promise.resolve().then(() => {
        applied.push("session")
      })],
      permissionPromise: () => Promise.resolve({ data: [] }),
      applyPermission: () => {
        applied.push("permission")
      },
      questionPromise: () => Promise.resolve({ data: [] }),
      applyQuestion: () => {
        applied.push("question")
      },
      sessionStatusPromise: () => Promise.resolve({ data: {} }),
      applySessionStatus: () => {
        applied.push("session-status")
      },
      providerAuthPromise: () => Promise.resolve({ data: {} }),
      applyProviderAuth: () => {
        applied.push("provider-auth")
      },
      pathPromise: () => Promise.resolve({ data: { state: "", config: "", worktree: "", directory: "" } }),
      pathFallback: { state: "", config: "", worktree: "", directory: "" },
      applyPath: () => {
        applied.push("path")
      },
      isolationTask: () => Promise.resolve().then(() => {
        applied.push("isolation")
      }),
      autonomousTask: () => Promise.resolve().then(() => {
        applied.push("autonomous")
      }),
    }).map((task) => task()))

    expect(applied.sort()).toEqual([
      "agents",
      "autonomous",
      "command",
      "config",
      "isolation",
      "path",
      "permission",
      "provider-auth",
      "provider-next",
      "provider-task",
      "question",
      "session",
      "session-status",
    ])
  })

  test("materializes the deferred bootstrap phase tasks through a single plan helper", async () => {
    const applied: string[] = []

    await Promise.all(createDeferredBootstrapPhaseTasks({
      lspPromise: () => Promise.resolve({ data: [] }),
      applyLsp: () => {
        applied.push("lsp")
      },
      mcpPromise: () => Promise.resolve({ data: {} }),
      applyMcp: () => {
        applied.push("mcp")
      },
      resourcePromise: () => Promise.resolve({ data: {} }),
      applyResources: () => {
        applied.push("resource")
      },
      formatterPromise: () => Promise.resolve({ data: [] }),
      applyFormatter: () => {
        applied.push("formatter")
      },
      vcsPromise: () => Promise.resolve({ data: undefined }),
      vcsFallback: undefined,
      applyVcs: () => {
        applied.push("vcs")
      },
      workspacesTask: () => Promise.resolve().then(() => {
        applied.push("workspaces")
      }),
      debugEngineTask: () => Promise.resolve().then(() => {
        applied.push("debug")
      }),
      smartLlmTask: () => Promise.resolve().then(() => {
        applied.push("smart")
      }),
    }).map((task) => task()))

    expect(applied.sort()).toEqual([
      "debug",
      "formatter",
      "lsp",
      "mcp",
      "resource",
      "smart",
      "vcs",
      "workspaces",
    ])
  })
})
