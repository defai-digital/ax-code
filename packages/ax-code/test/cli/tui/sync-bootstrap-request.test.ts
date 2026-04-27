import { describe, expect, test } from "bun:test"
import {
  createSyncBootstrapRequests,
  createTimedBootstrapRequest,
  createTimedBootstrapRequests,
  type SyncBootstrapRequestClient,
} from "../../../src/cli/cmd/tui/context/sync-bootstrap-request"

describe("tui sync bootstrap request", () => {
  test("wraps a timed request and runs its settled hook", async () => {
    const wrapped: Array<{ label: string; timeoutMs?: number }> = []
    const settled: string[] = []

    const result = await createTimedBootstrapRequest(
      (label, request, timeoutMs) => {
        wrapped.push({ label, timeoutMs })
        return request
      },
      {
        label: "tui bootstrap test",
        request: () => Promise.resolve("ok"),
        timeoutMs: 42,
        onSettled() {
          settled.push("done")
        },
      },
    )()

    expect(result).toBe("ok")
    expect(wrapped).toEqual([{ label: "tui bootstrap test", timeoutMs: 42 }])
    expect(settled).toEqual(["done"])
  })

  test("runs the settled hook even when the request rejects", async () => {
    const settled: string[] = []

    await expect(
      createTimedBootstrapRequest((_label, request) => request, {
        label: "tui bootstrap failing-test",
        request: () => Promise.reject(new Error("boom")),
        onSettled() {
          settled.push("done")
        },
      })(),
    ).rejects.toThrow("boom")

    expect(settled).toEqual(["done"])
  })

  test("runs the settled hook when the request factory throws synchronously", async () => {
    const settled: string[] = []

    await expect(
      createTimedBootstrapRequest((_label, request) => request, {
        label: "tui bootstrap sync-throw",
        request: () => {
          throw new Error("sync boom")
        },
        onSettled() {
          settled.push("done")
        },
      })(),
    ).rejects.toThrow("sync boom")

    expect(settled).toEqual(["done"])
  })

  test("materializes a keyed bundle of timed bootstrap requests", async () => {
    const wrapped: string[] = []

    const requests = createTimedBootstrapRequests(
      (label, request) => {
        wrapped.push(label)
        return request
      },
      {
        alpha: {
          label: "tui bootstrap alpha",
          request: () => Promise.resolve(1),
        },
        beta: {
          label: "tui bootstrap beta",
          request: () => Promise.resolve("x"),
        },
      },
    )

    await expect(requests.alpha()).resolves.toBe(1)
    await expect(requests.beta()).resolves.toBe("x")
    expect(wrapped).toEqual(["tui bootstrap alpha", "tui bootstrap beta"])
  })

  test("builds the full sync bootstrap request bundle lazily with consistent labels and options", async () => {
    const wrapped: string[] = []
    const settled: string[] = []
    const options = {
      providersThrowOnError: false,
      providerListThrowOnError: false,
      agentsThrowOnError: false,
      configThrowOnError: false,
      sessionListStart: 0,
    }
    const sideEffects: string[] = []

    const client = {
      session: {
        list(args: { start: number }) {
          options.sessionListStart = args.start
          return Promise.resolve({ data: [{ id: "ses_b" }, { id: "ses_a" }] })
        },
        status() {
          return Promise.resolve({ data: {} })
        },
      },
      config: {
        providers(_body: {}, opts?: { throwOnError?: boolean }) {
          options.providersThrowOnError = !!opts?.throwOnError
          return Promise.resolve({ data: { providers: [], default: {} } })
        },
        get(_body: {}, opts?: { throwOnError?: boolean }) {
          options.configThrowOnError = !!opts?.throwOnError
          return Promise.resolve({ data: {} })
        },
      },
      provider: {
        list(_body: {}, opts?: { throwOnError?: boolean }) {
          options.providerListThrowOnError = !!opts?.throwOnError
          return Promise.resolve({ data: { all: [], connected: [], default: {} } })
        },
        auth() {
          return Promise.resolve({ data: {} })
        },
      },
      app: {
        agents(_body: {}, opts?: { throwOnError?: boolean }) {
          options.agentsThrowOnError = !!opts?.throwOnError
          return Promise.resolve({ data: [] })
        },
      },
      command: {
        list() {
          return Promise.resolve({ data: [] })
        },
      },
      permission: {
        list() {
          return Promise.resolve({ data: [] })
        },
      },
      question: {
        list() {
          return Promise.resolve({ data: [] })
        },
      },
      path: {
        get() {
          return Promise.resolve({ data: { state: "", config: "", worktree: "", directory: "" } })
        },
      },
      lsp: {
        status() {
          return Promise.resolve({ data: [] })
        },
      },
      mcp: {
        status() {
          return Promise.resolve({ data: {} })
        },
      },
      experimental: {
        resource: {
          list() {
            return Promise.resolve({ data: {} })
          },
        },
      },
      formatter: {
        status() {
          return Promise.resolve({ data: [] })
        },
      },
      vcs: {
        get() {
          return Promise.resolve({ data: undefined })
        },
      },
    } as unknown as SyncBootstrapRequestClient

    const requests = createSyncBootstrapRequests({
      wrap(label, request) {
        wrapped.push(label)
        return request
      },
      client,
      sessionListStart: 42,
      onSessionListSettled() {
        settled.push("session-list")
      },
      syncIsolation() {
        sideEffects.push("isolation")
        return Promise.resolve()
      },
      syncAutonomous() {
        sideEffects.push("autonomous")
        return Promise.resolve()
      },
      syncWorkspaces() {
        sideEffects.push("workspaces")
        return Promise.resolve()
      },
      syncDebugEngine() {
        sideEffects.push("debug")
        return Promise.resolve()
      },
      syncSmartLlm() {
        sideEffects.push("smart")
        return Promise.resolve()
      },
    })

    expect(wrapped).toEqual([])
    expect(sideEffects).toEqual([])

    await expect(requests.sessionListPromise()).resolves.toEqual([{ id: "ses_a" }, { id: "ses_b" }])
    expect(settled).toEqual(["session-list"])
    expect(options).toEqual({
      providersThrowOnError: false,
      providerListThrowOnError: false,
      agentsThrowOnError: false,
      configThrowOnError: false,
      sessionListStart: 42,
    })
    await Promise.all([
      requests.providersPromise(),
      requests.providerListPromise(),
      requests.agentsPromise(),
      requests.configPromise(),
      requests.commandPromise(),
      requests.permissionPromise(),
      requests.questionPromise(),
      requests.sessionStatusPromise(),
      requests.providerAuthPromise(),
      requests.pathPromise(),
      requests.isolationTask(),
      requests.autonomousTask(),
      requests.lspPromise(),
      requests.mcpPromise(),
      requests.resourcePromise(),
      requests.formatterPromise(),
      requests.vcsPromise(),
      requests.workspacesTask(),
      requests.debugEngineTask(),
      requests.smartLlmTask(),
    ])
    expect(options).toEqual({
      providersThrowOnError: true,
      providerListThrowOnError: true,
      agentsThrowOnError: true,
      configThrowOnError: true,
      sessionListStart: 42,
    })
    expect(sideEffects).toEqual(["isolation", "autonomous", "workspaces", "debug", "smart"])
    expect(wrapped).toEqual([
      "tui bootstrap session.list",
      "tui bootstrap config.providers",
      "tui bootstrap provider.list",
      "tui bootstrap app.agents",
      "tui bootstrap config.get",
      "tui bootstrap command.list",
      "tui bootstrap permission.list",
      "tui bootstrap question.list",
      "tui bootstrap session.status",
      "tui bootstrap provider.auth",
      "tui bootstrap path.get",
      "tui bootstrap isolation",
      "tui bootstrap autonomous",
      "tui bootstrap lsp.status",
      "tui bootstrap mcp.status",
      "tui bootstrap resource.list",
      "tui bootstrap formatter.status",
      "tui bootstrap vcs.get",
      "tui bootstrap worktree.list",
      "tui bootstrap debug-engine",
      "tui bootstrap smart-llm",
    ])
  })
})
