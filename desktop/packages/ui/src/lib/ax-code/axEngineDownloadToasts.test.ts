import { describe, expect, test } from "vitest"
import { createDownloadToastTracker } from "./axEngineDownloadToasts"
import type { AxEngineModelJobSummary } from "./axEngineModelsApi"

type ToastCall = { kind: "loading" | "success" | "error" | "dismiss"; message?: string; id: string }

function makeHarness(fetchJobs?: () => Promise<AxEngineModelJobSummary[]>) {
  const toasts: ToastCall[] = []
  const intervals: Array<{ fn: () => void; ms: number; cleared: boolean }> = []
  let clock = 0
  let fetchCount = 0
  const queue: AxEngineModelJobSummary[][] = []

  const tracker = createDownloadToastTracker({
    toast: {
      loading: (message, options) => toasts.push({ kind: "loading", message, id: options.id }),
      success: (message, options) => toasts.push({ kind: "success", message, id: options.id }),
      error: (message, options) => toasts.push({ kind: "error", message, id: options.id }),
      dismiss: (id) => toasts.push({ kind: "dismiss", id }),
    },
    fetchJobs:
      fetchJobs ??
      (async () => {
        fetchCount += 1
        return queue.shift() ?? []
      }),
    setInterval: (fn, ms) => {
      intervals.push({ fn, ms, cleared: false })
      return intervals.length - 1
    },
    clearInterval: (id) => {
      const entry = intervals[id]
      if (entry) entry.cleared = true
    },
    now: () => clock,
  })

  return {
    tracker,
    toasts,
    queue,
    advanceClock: (ms: number) => (clock += ms),
    fetchCount: () => fetchCount,
    activeTimer: () => intervals.find((entry) => !entry.cleared),
  }
}

const job = (id: string, status: AxEngineModelJobSummary["status"], error?: string): AxEngineModelJobSummary =>
  ({ id, type: "download", modelID: "gemma-4-12b", quantization: "mlx6bit", status, error }) as AxEngineModelJobSummary

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe("axEngineDownloadToasts tracker", () => {
  test("announce shows a persistent toast and starts its own polling", () => {
    const h = makeHarness()
    h.tracker.announce({ id: "j1" }, "Gemma 4 12B", null)

    expect(h.toasts).toEqual([{ kind: "loading", message: "Downloading Gemma 4 12B…", id: "axe-dl-j1" }])
    expect(h.activeTimer()).toBeDefined()
    expect(h.tracker.hasAnnounced()).toBe(true)
  })

  test("reconcile resolves terminal states and stops polling once drained", () => {
    const h = makeHarness()
    h.tracker.announce({ id: "ok" }, "Model A", null)
    h.tracker.announce({ id: "bad" }, "Model B", null)
    h.tracker.announce({ id: "gone" }, "Model C", null)

    h.tracker.reconcile([job("ok", "complete"), job("bad", "failed", "disk full"), job("gone", "cancelled")])

    expect(h.toasts.filter((entry) => entry.kind !== "loading")).toEqual([
      { kind: "success", message: "Model A downloaded", id: "axe-dl-ok" },
      { kind: "error", message: "Model B download failed", id: "axe-dl-bad" },
      { kind: "dismiss", id: "axe-dl-gone" },
    ])
    expect(h.tracker.hasAnnounced()).toBe(false)
    expect(h.activeTimer()).toBeUndefined()
  })

  test("a running job keeps the toast and the polling alive", () => {
    const h = makeHarness()
    h.tracker.announce({ id: "j1" }, "Model A", null)
    h.tracker.reconcile([job("j1", "running")])

    expect(h.toasts).toHaveLength(1)
    expect(h.tracker.hasAnnounced()).toBe(true)
    expect(h.activeTimer()).toBeDefined()
  })

  test("a job missing from the server list is only reported after the grace window", () => {
    const h = makeHarness()
    h.tracker.announce({ id: "j1" }, "Model A", null)

    // Immediately missing (stale payload from before the download started):
    // must stay pending.
    h.tracker.reconcile([])
    expect(h.tracker.hasAnnounced()).toBe(true)
    expect(h.toasts.filter((entry) => entry.kind === "error")).toHaveLength(0)

    // Still missing after the grace window: the CLI restarted and lost its
    // in-memory job registry — resolve rather than spin forever.
    h.advanceClock(11_000)
    h.tracker.reconcile([])
    expect(h.toasts.at(-1)).toEqual({
      kind: "error",
      message: "Model A download interrupted",
      id: "axe-dl-j1",
    })
    expect(h.tracker.hasAnnounced()).toBe(false)
    expect(h.activeTimer()).toBeUndefined()
  })

  test("polls resolve toasts without any page mounted", async () => {
    const h = makeHarness()
    h.queue.push([job("j1", "running")], [job("j1", "complete")])
    h.tracker.announce({ id: "j1" }, "Model A", null)

    const timer = h.activeTimer()
    expect(timer).toBeDefined()

    // Simulate the interval firing with no component around to reconcile.
    timer!.fn()
    await flush()
    expect(h.tracker.hasAnnounced()).toBe(true)

    timer!.fn()
    await flush()
    expect(h.toasts.at(-1)).toEqual({ kind: "success", message: "Model A downloaded", id: "axe-dl-j1" })
    expect(h.tracker.hasAnnounced()).toBe(false)
    expect(h.activeTimer()).toBeUndefined()
    expect(h.fetchCount()).toBe(2)
  })

  test("fetch failures during a poll keep the toast pending and polling alive", async () => {
    let calls = 0
    const h = makeHarness(async () => {
      calls += 1
      throw new Error("CLI restarting")
    })
    h.tracker.announce({ id: "j1" }, "Model A", null)

    h.activeTimer()!.fn()
    await flush()

    expect(calls).toBe(1)
    expect(h.tracker.hasAnnounced()).toBe(true)
    expect(h.activeTimer()).toBeDefined()
    expect(h.toasts.filter((entry) => entry.kind === "error")).toHaveLength(0)
  })
})
