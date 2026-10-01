import { describe, expect, test, vi } from "vitest"
import { projectWikiManifest } from "@ax-code/ax-wiki/graph"
import type { WikiMaintenanceStatus } from "../../../src/wiki/idle-controller"
import {
  createWikiVisualizationManager,
  fetchWikiVisualization,
  monitorWikiViewer,
  requestWikiMaintenance,
  WikiVizError,
} from "../../../src/cli/tui/util/wiki-visualization"

const graph = projectWikiManifest(
  {
    schemaVersion: 1,
    generator: "ax-wiki",
    pages: {
      "guide.md": { title: "Guide", sources: ["src/a.ts"], sourceHashes: { "src/a.ts": "a".repeat(64) } },
    },
  },
  { snapshot: "sha256:" + "a".repeat(64) },
)
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function setup() {
  const listeners: Array<{ url: string; close: ReturnType<typeof vi.fn> }> = []
  const serve = vi.fn(async () => {
    const listener = { url: `http://127.0.0.1:1234/${listeners.length}`, close: vi.fn(async () => {}) }
    listeners.push(listener)
    return listener
  })
  const openBrowser = vi.fn(async () => {})
  const manager = createWikiVisualizationManager({ serve, openBrowser })
  const load = vi.fn(async () => graph)
  return {
    manager,
    serve,
    openBrowser,
    listeners,
    load,
    request: { scope: "runtime/project", load, isCurrent: () => true },
  }
}
describe("TUI Wiki viewer ownership", () => {
  test("deduplicates pending activation, refreshes snapshots and reuses identical listeners", async () => {
    const s = setup()
    const pending = deferred<typeof graph>()
    s.load.mockImplementationOnce(() => pending.promise)
    const first = s.manager.activate(s.request)
    expect(s.manager.activate(s.request)).toBe(first)
    pending.resolve(graph)
    await first
    await s.manager.activate(s.request)
    expect(s.load).toHaveBeenCalledTimes(2)
    expect(s.serve).toHaveBeenCalledTimes(1)
    s.load.mockResolvedValueOnce({ ...graph, snapshot: "sha256:" + "b".repeat(64) })
    await s.manager.activate(s.request)
    expect(s.listeners[0].close).toHaveBeenCalledTimes(1)
    expect(s.serve).toHaveBeenCalledTimes(2)
    await s.manager.dispose()
    await s.manager.dispose()
    expect(s.listeners[1].close).toHaveBeenCalledTimes(1)
    await expect(s.manager.activate(s.request)).rejects.toMatchObject({ name: "AbortError" })
  })
  test("disposal waits for late listener startup and closes it without opening a browser", async () => {
    const s = setup()
    const started = deferred<void>()
    const listener = { url: "http://127.0.0.1:1234/secret", close: vi.fn(async () => {}) }
    const late = deferred<typeof listener>()
    s.serve.mockImplementationOnce(async () => {
      started.resolve()
      return late.promise
    })
    const activation = s.manager.activate(s.request)
    const rejected = expect(activation).rejects.toMatchObject({ name: "AbortError" })
    await started.promise
    const disposal = s.manager.dispose()
    late.resolve(listener)
    await rejected
    await disposal
    expect(listener.close).toHaveBeenCalledTimes(1)
    expect(s.openBrowser).not.toHaveBeenCalled()
  })
  test("rejects stale runtime responses before binding a listener", async () => {
    const s = setup()
    let current = true
    s.load.mockImplementationOnce(async () => {
      current = false
      return graph
    })
    await expect(s.manager.activate({ ...s.request, isCurrent: () => current })).rejects.toMatchObject({
      data: { reason: "context_changed" },
    })
    expect(s.serve).not.toHaveBeenCalled()
    await s.manager.dispose()
  })
  test("exit cancels a stuck browser launcher without waiting for its promise", async () => {
    const s = setup()
    const started = deferred<void>()
    const stuck = deferred<void>()
    s.openBrowser.mockImplementationOnce(async () => {
      started.resolve()
      return stuck.promise
    })
    const activation = s.manager.activate(s.request)
    const rejected = expect(activation).rejects.toMatchObject({ name: "AbortError" })
    await started.promise
    await s.manager.dispose()
    await rejected
    expect(s.listeners[0].close).toHaveBeenCalledTimes(1)
    stuck.resolve()
  })
  test("a finished live monitor is restarted on a later activation of the same project", async () => {
    const s = setup()
    const monitor = vi.fn(async () => {})
    await s.manager.activate({ ...s.request, monitor })
    await s.manager.activate({ ...s.request, monitor })
    expect(monitor).toHaveBeenCalledTimes(2)
    expect(s.listeners[0].close).toHaveBeenCalledTimes(1)
    await s.manager.dispose()
  })
  test("coalesced opens send one explicit refresh", async () => {
    const s = setup()
    const pending = deferred<typeof graph>()
    s.load.mockImplementationOnce(() => pending.promise)
    const refresh = vi.fn(async () => {})
    const first = s.manager.activate({ ...s.request, refresh })
    const second = s.manager.activate({ ...s.request, refresh })
    pending.resolve(graph)
    await Promise.all([first, second])
    expect(refresh).toHaveBeenCalledTimes(1)
    await s.manager.dispose()
  })
  test("browser failure returns the owned URL for an explicit copy fallback", async () => {
    const s = setup()
    s.openBrowser.mockRejectedValueOnce(new Error("No browser"))
    expect(await s.manager.activate(s.request)).toEqual({ url: "http://127.0.0.1:1234/0", opened: false })
    await s.manager.dispose()
  })
})
describe("runtime Wiki snapshot transport", () => {
  test("uses the connected fetch and encoded runtime directory, never local artifacts", async () => {
    const transport = vi.fn<typeof fetch>(async () => Response.json(graph))
    expect(
      await fetchWikiVisualization({
        base: "https://runtime.example/",
        directory: "/remote/project",
        fetch: transport,
        signal: new AbortController().signal,
      }),
    ).toEqual(graph)
    expect(String(transport.mock.calls[0][0])).toBe("https://runtime.example/experimental/wiki-visualization")
    expect(transport.mock.calls[0][1]?.headers).toMatchObject({ "x-opencode-directory": "/remote/project" })
  })
  test.each([
    [401, "unauthorized"],
    [403, "unauthorized"],
    [404, "unsupported"],
    [400, "missing"],
  ])("classifies HTTP %s", async (status, reason) => {
    await expect(
      fetchWikiVisualization({
        base: "http://runtime/",
        fetch: async () => Response.json({ code: "missing" }, { status }),
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ data: { reason } })
  })
  test("rejects oversized streaming bodies and malformed successful responses", async () => {
    for (const [response, reason] of [
      [new Response("x".repeat(2 * 1024 * 1024 + 1)), "too_large"],
      [Response.json({ schemaVersion: 99 }), "invalid"],
    ] as const) {
      await expect(
        fetchWikiVisualization({
          base: "http://runtime/",
          fetch: async () => response,
          signal: new AbortController().signal,
        }),
      ).rejects.toMatchObject({ data: { reason } })
    }
  })
  test("maintenance registration carries the invoking session to the runtime", async () => {
    const status = { phase: "ready", reason: "complete", completed: 0, total: 0, revision: 0 }
    const transport = vi.fn<typeof fetch>(async () => Response.json(status))
    await requestWikiMaintenance({
      base: "http://runtime/",
      fetch: transport,
      signal: new AbortController().signal,
      action: "enable",
      agent: "build",
      active: false,
      sessionID: "ses_invoking_session",
    })
    expect(String(transport.mock.calls[0][0])).toBe("http://runtime/experimental/wiki-maintenance/enable")
    expect(JSON.parse(String(transport.mock.calls[0][1]?.body))).toEqual({
      agent: "build",
      active: false,
      sessionID: "ses_invoking_session",
    })
    await requestWikiMaintenance({
      base: "http://runtime/",
      fetch: transport,
      signal: new AbortController().signal,
      action: "refresh",
    })
    expect(JSON.parse(String(transport.mock.calls[1][1]?.body))).toEqual({ agent: "build", active: false })
  })
})
describe("live Wiki viewer monitor", () => {
  const ready = (revision: number): WikiMaintenanceStatus => ({
    phase: "ready",
    reason: "complete",
    completed: 0,
    total: 0,
    revision,
  })
  const failed = { phase: "failed", reason: "failed", completed: 0, total: 0, revision: 0 }
  function monitorSetup(input: { limit: number; onPoll?: (poll: number) => void }) {
    const controller = new AbortController()
    const updates: Array<{ status: unknown; graph: unknown; problem: unknown }> = []
    const onStatus = vi.fn()
    const listener = {
      url: "http://127.0.0.1:1234/live",
      close: vi.fn(async () => {}),
      update: vi.fn((status: unknown, graph?: unknown, problem?: unknown) => {
        updates.push({ status, graph, problem })
      }),
    }
    let polls = 0
    const delay = vi.fn(async () => {
      polls++
      input.onPoll?.(polls)
      if (polls >= input.limit) controller.abort()
    })
    const run = (overrides: Partial<Omit<Parameters<typeof monitorWikiViewer>[0], "listener" | "signal">>) =>
      monitorWikiViewer({
        listener,
        signal: controller.signal,
        isCurrent: () => true,
        status: async () => ready(1),
        snapshot: async () => graph,
        delay,
        now: () => 0,
        onStatus,
        ...overrides,
      })
    return { controller, updates, onStatus, listener, delay, run }
  }
  test("a snapshot failure publishes the real ready status with a snapshot problem", async () => {
    const s = monitorSetup({ limit: 2 })
    const snapshot = vi.fn(async () => {
      throw new WikiVizError({ reason: "invalid", message: "The runtime returned an invalid Wiki snapshot." })
    })
    await s.run({ snapshot })
    expect(snapshot).toHaveBeenCalledTimes(1)
    expect(s.updates).toEqual([
      { status: ready(1), graph: undefined, problem: "invalid" },
      { status: ready(1), graph: undefined, problem: "invalid" },
    ])
    expect(s.onStatus).toHaveBeenCalledTimes(2)
    for (const [status] of s.onStatus.mock.calls) expect(status).toEqual(ready(1))
  })
  test("a retryable snapshot failure backs off and a revision change retries immediately", async () => {
    let clock = 0
    let revision = 1
    const s = monitorSetup({
      limit: 6,
      onPoll: (poll) => {
        if (poll === 2) clock = 2999
        if (poll === 3) clock = 3000
        if (poll === 4) revision = 2
      },
    })
    const snapshot = vi.fn(async () => {
      throw new WikiVizError({ reason: "failed", message: "Could not load the Wiki snapshot." })
    })
    await s.run({ snapshot, now: () => clock, status: async () => ready(revision) })
    expect(snapshot).toHaveBeenCalledTimes(3)
    expect(s.updates).toHaveLength(6)
    expect(s.updates.every((update) => update.problem === "failed" && update.graph === undefined)).toBe(true)
  })
  test("a new revision starts with a fresh retry budget", async () => {
    let clock = 0
    let revision = 1
    const s = monitorSetup({
      limit: 5,
      onPoll: (poll) => {
        if (poll === 1) clock = 3000
        if (poll === 2) revision = 2
        if (poll === 3) clock = 5999
        if (poll === 4) clock = 6000
      },
    })
    const snapshot = vi.fn(async () => {
      throw new WikiVizError({ reason: "failed", message: "Could not load the Wiki snapshot." })
    })
    await s.run({ snapshot, now: () => clock, status: async () => ready(revision) })
    // Attempts: first poll, first backoff (3 s), the new revision, then that revision's own 3 s backoff.
    expect(snapshot).toHaveBeenCalledTimes(4)
  })
  test("a later successful snapshot publishes the graph and clears the problem", async () => {
    let clock = 0
    const s = monitorSetup({
      limit: 2,
      onPoll: () => {
        clock = 10_000
      },
    })
    const snapshot = vi.fn(async () => graph)
    snapshot.mockRejectedValueOnce(
      new WikiVizError({ reason: "too_large", message: "Wiki snapshot exceeds the limit." }),
    )
    snapshot.mockResolvedValueOnce(graph)
    await s.run({ snapshot, now: () => clock })
    expect(snapshot).toHaveBeenCalledTimes(2)
    expect(s.updates[0]).toEqual({ status: ready(1), graph: undefined, problem: "too_large" })
    expect(s.updates[1]).toEqual({ status: ready(1), graph, problem: null })
  })
  test("a missing snapshot is not a problem and does not retry", async () => {
    const s = monitorSetup({ limit: 3 })
    const snapshot = vi.fn(async () => {
      throw new WikiVizError({ reason: "missing", message: "No Wiki manifest found." })
    })
    await s.run({ snapshot })
    expect(snapshot).toHaveBeenCalledTimes(1)
    expect(s.updates).toEqual([
      { status: ready(1), graph: undefined, problem: null },
      { status: ready(1), graph: undefined, problem: null },
      { status: ready(1), graph: undefined, problem: null },
    ])
  })
  test("a status request failure keeps publishing the synthetic failed status", async () => {
    const s = monitorSetup({ limit: 2 })
    const snapshot = vi.fn(async () => graph)
    await s.run({
      status: async () => {
        throw new WikiVizError({ reason: "unauthorized", message: "The connected runtime denied access." })
      },
      snapshot,
    })
    expect(snapshot).not.toHaveBeenCalled()
    expect(s.updates).toEqual([
      { status: failed, graph: undefined, problem: undefined },
      { status: failed, graph: undefined, problem: undefined },
    ])
    expect(s.onStatus).toHaveBeenCalledTimes(2)
    expect(s.onStatus).toHaveBeenCalledWith(failed)
  })
  test("an unsupported snapshot problem is not retried until the revision changes", async () => {
    let revision = 1
    const s = monitorSetup({
      limit: 3,
      onPoll: (poll) => {
        if (poll === 2) revision = 5
      },
    })
    const snapshot = vi.fn(async () => {
      throw new WikiVizError({ reason: "unsupported", message: "The connected runtime does not support it." })
    })
    await s.run({ snapshot, now: () => 1_000_000, status: async () => ready(revision) })
    expect(snapshot).toHaveBeenCalledTimes(2)
    expect(s.updates).toEqual([
      { status: ready(1), graph: undefined, problem: "unsupported" },
      { status: ready(1), graph: undefined, problem: "unsupported" },
      { status: ready(5), graph: undefined, problem: "unsupported" },
    ])
  })
  test("a failure after an earlier graph reports the problem without resending the stale graph", async () => {
    let revision = 1
    const s = monitorSetup({
      limit: 3,
      onPoll: (poll) => {
        if (poll === 2) revision = 2
      },
    })
    const snapshot = vi.fn(async () => graph)
    snapshot.mockResolvedValueOnce(graph)
    snapshot.mockRejectedValueOnce(new WikiVizError({ reason: "invalid", message: "Invalid Wiki snapshot." }))
    await s.run({ snapshot, status: async () => ready(revision) })
    expect(snapshot).toHaveBeenCalledTimes(2)
    // A listener clears its problem whenever it is handed a graph, so only the fetching poll may carry one.
    expect(s.updates).toEqual([
      { status: ready(1), graph, problem: null },
      { status: ready(1), graph: undefined, problem: null },
      { status: ready(2), graph: undefined, problem: "invalid" },
    ])
  })
  test("a workspace change during the snapshot request publishes nothing", async () => {
    let current = true
    const s = monitorSetup({ limit: 2 })
    await s.run({
      isCurrent: () => current,
      snapshot: async () => {
        current = false
        return graph
      },
    })
    expect(s.updates).toEqual([])
    expect(s.onStatus).not.toHaveBeenCalled()
  })
})
