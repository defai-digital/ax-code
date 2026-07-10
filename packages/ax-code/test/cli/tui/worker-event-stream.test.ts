import { describe, expect, test, vi } from "vitest"

// Regression coverage for the worker's setWorkspace race: two concurrent
// setWorkspace RPCs both passed the check-then-act teardown in
// startEventStream and each installed an event stream, leaving one
// controller orphaned — it kept emitting events for the old workspace for
// the process lifetime and survived shutdown's drain. The fix mirrors the
// sseGeneration guard from context/sdk.tsx.

const streamState = vi.hoisted(() => ({ active: 0, started: 0 }))

vi.mock("@tui/util/resilient-stream", () => ({
  runResilientStream: (opts: { signal: AbortSignal }) => {
    streamState.started++
    streamState.active++
    return new Promise<void>((resolve) => {
      const finish = () => {
        streamState.active--
        resolve()
      }
      if (opts.signal.aborted) return queueMicrotask(finish)
      opts.signal.addEventListener("abort", finish, { once: true })
    })
  },
}))

// worker.ts runs heavy side effects at import time (logging, diagnostics,
// server plumbing); stub the whole boundary so the test exercises only the
// event-stream lifecycle.
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
vi.mock("@/util/rpc", () => ({ Rpc: { emit: () => {}, listen: () => {}, listenStdio: async () => {} } }))
vi.mock("@/cli/upgrade", () => ({ upgrade: async () => {} }))
vi.mock("@/config/config", () => ({ Config: { global: { reset: () => {} } } }))
vi.mock("@/bus/global", () => ({ GlobalBus: { on: () => {}, off: () => {} } }))
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

describe("worker event stream lifecycle", () => {
  test("concurrent setWorkspace calls install exactly one stream; shutdown drains it", async () => {
    const { rpc } = await import("@tui/worker")

    await rpc.setWorkspace({ workspaceID: "/workspace/one" })
    expect(streamState.active).toBe(1)

    const startedBefore = streamState.started
    await Promise.all([
      rpc.setWorkspace({ workspaceID: "/workspace/two" }),
      rpc.setWorkspace({ workspaceID: "/workspace/three" }),
    ])
    // Without the generation guard both calls pass the teardown await and
    // each installs a stream (two new starts, two active, one orphaned).
    expect(streamState.started - startedBefore).toBe(1)
    expect(streamState.active).toBe(1)

    await rpc.shutdown()
    expect(streamState.active).toBe(0)
  })
})
