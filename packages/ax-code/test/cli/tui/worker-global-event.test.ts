import { beforeEach, describe, expect, test, vi } from "vitest"

// Regression coverage for duplicate TUI event delivery: the worker's own
// "/event" SSE stream already carries every event published by the active
// workspace instance, so forwarding the same GlobalBus event over the
// "global.event" RPC channel handed the TUI a second, un-coalesced copy of
// every message.part.delta/updated. Only events that stream cannot carry
// (installation.* notifications and other-directory events) may be forwarded.

const bus = vi.hoisted(() => ({
  listener: undefined as undefined | ((event: unknown) => void),
}))

const wire = vi.hoisted(() => ({
  globalEvents: [] as unknown[],
  streamEvents: [] as unknown[],
}))

vi.mock("@/bus/global", () => ({
  GlobalBus: {
    on: (_name: string, listener: (event: unknown) => void) => {
      bus.listener = listener
    },
    off: () => {},
  },
}))

vi.mock("@/util/rpc", () => ({
  Rpc: {
    emit: (channel: string, event: unknown) => {
      if (channel === "global.event") wire.globalEvents.push(event)
      if (channel === "event") wire.streamEvents.push(event)
    },
    listen: () => {},
    listenStdio: async () => {},
  },
}))

vi.mock("@tui/util/resilient-stream", () => ({
  runResilientStream: (opts: { signal: AbortSignal }) =>
    new Promise<void>((resolve) => {
      const finish = () => resolve()
      if (opts.signal.aborted) return queueMicrotask(finish)
      opts.signal.addEventListener("abort", finish, { once: true })
    }),
}))

// worker.ts runs heavy side effects at import time (logging, diagnostics,
// server plumbing); stub the whole boundary so the test exercises only the
// global.event forwarding decision.
vi.mock("@tui/util/lifecycle", () => ({ registerTuiProcessHandler: () => {} }))
// CHANNEL kept because the shared preload's afterAll imports src/storage/db,
// which reads Installation.CHANNEL through this same mocked module.
vi.mock("@/installation", () => ({
  Installation: { VERSION: "0.0.0-test", CHANNEL: "latest", isLocal: () => false },
}))
vi.mock("@/installation/runtime-mode", () => ({ runtimeMode: () => "test" }))
vi.mock("@/cli/boolean-flag", () => ({ cliBooleanFlagValue: () => false }))
vi.mock("@/server/server", () => ({
  Server: {
    Default: () => ({ fetch: async () => new Response("") }),
    listen: async () => ({ stop: async () => {}, url: new URL("http://localhost:1/") }),
  },
}))
vi.mock("@/util/log", () => {
  const sink = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
  return { Log: { init: async () => {}, stampedName: (name: string) => name, Default: sink, create: () => sink } }
})
vi.mock("@/project/instance", () => ({ Instance: { provide: async () => {}, disposeAll: async () => {} } }))
vi.mock("@/project/bootstrap", () => ({ InstanceBootstrap: async () => {} }))
vi.mock("@/cli/upgrade", () => ({ upgrade: async () => {} }))
vi.mock("@/config/config", () => ({ Config: { global: { reset: () => {} } } }))
vi.mock("@ax-code/sdk/v2", () => ({ createAxCodeClient: () => ({ event: { subscribe: async () => ({}) } }) }))
vi.mock("@/flag/flag", () => ({ Flag: {} }))
vi.mock("@/debug/diagnostic-log", () => ({
  DiagnosticLog: { configure: async () => {}, installProcessDiagnostics: () => {}, recordProcess: () => {} },
}))
vi.mock("@/util/internal-url", () => ({ internalBaseUrl: () => "http://internal.test" }))
vi.mock("@/server/runtime-auth", () => ({
  ServerRuntimeAuth: { HEADER: "x-test-auth", apply: () => {}, headers: () => ({ "x-test-auth": "" }) },
}))
vi.mock("@/util/signals", () => ({ registerShutdownSignals: () => () => {} }))
vi.mock("@/provider/ax-engine", () => ({ stopServer: async () => {} }))

const delta = { type: "message.part.delta", properties: { sessionID: "ses_1", partID: "prt_1", delta: "x" } }
const update = { type: "installation.updated", properties: { version: "9.0.0" } }
const partUpdated = { type: "message.part.updated", properties: { part: { id: "prt_2" } } }

describe("worker global.event forwarding", () => {
  beforeEach(() => {
    vi.resetModules()
    bus.listener = undefined
    wire.globalEvents.length = 0
    wire.streamEvents.length = 0
  })

  test("forwards every global event while no workspace stream is installed", async () => {
    await import("@tui/worker")
    const event = { directory: "/workspace/active", payload: delta }

    bus.listener!(event)

    expect(wire.globalEvents).toEqual([event])
  })

  test("drops same-directory events the /event stream already carries", async () => {
    const { rpc } = await import("@tui/worker")
    const workspace = "/workspace/active"
    await rpc.setWorkspace({ workspaceID: workspace })

    bus.listener!({ directory: workspace, payload: delta })
    expect(wire.globalEvents).toEqual([])

    // An event scoped by its own properties to another directory is dropped by
    // the "/event" filter, so the RPC channel must still carry it.
    const scoped = { type: "session.updated", properties: { directory: "/workspace/elsewhere", info: {} } }
    bus.listener!({ directory: workspace, payload: scoped })
    expect(wire.globalEvents).toEqual([{ directory: workspace, payload: scoped }])
  })

  test("still forwards installation.* and other-directory events", async () => {
    const { rpc } = await import("@tui/worker")
    const workspace = "/workspace/active"
    await rpc.setWorkspace({ workspaceID: workspace })

    // The background upgrade check publishes against the launch cwd, which can
    // differ from the active workspace.
    bus.listener!({ directory: "/launch/cwd", payload: update })
    bus.listener!({ directory: "/workspace/other", payload: partUpdated })

    expect(wire.globalEvents).toEqual([
      { directory: "/launch/cwd", payload: update },
      { directory: "/workspace/other", payload: partUpdated },
    ])
  })

  test("resumes forwarding once the workspace stream is gone", async () => {
    const { rpc } = await import("@tui/worker")
    const workspace = "/workspace/active"
    await rpc.setWorkspace({ workspaceID: workspace })
    await rpc.shutdown()

    const event = { directory: workspace, payload: delta }
    bus.listener!(event)

    expect(wire.globalEvents).toEqual([event])
  })
})
