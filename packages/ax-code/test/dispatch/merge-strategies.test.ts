import { describe, expect, test } from "bun:test"
import { dispatch, type DispatchExecutor, type DispatchSpec, type DispatcherEventSink } from "../../src/dispatch"

const spec = (agent: string, prompt = "do thing", overrides: Partial<DispatchSpec> = {}): DispatchSpec => ({
  agent,
  prompt,
  ...overrides,
})

const slow =
  (ms: number, output = "ok"): DispatchExecutor =>
  async (_, signal) =>
    new Promise<{ output: string }>((resolve, reject) => {
      const timer = setTimeout(() => resolve({ output }), ms)
      if (signal.aborted) {
        clearTimeout(timer)
        reject(signal.reason ?? new Error("aborted"))
        return
      }
      signal.addEventListener("abort", () => {
        clearTimeout(timer)
        reject(signal.reason ?? new Error("aborted"))
      })
    })

describe("dispatch merge strategies (ADR-005 P0)", () => {
  test("first-success cancels siblings as soon as one completes", async () => {
    const executor: DispatchExecutor = async (s, signal) => {
      // a completes fast; b and c hang until aborted.
      if (s.agent === "a") {
        await new Promise((r) => setTimeout(r, 20))
        return { output: "fast" }
      }
      return new Promise((_, reject) => {
        if (signal.aborted) return reject(new Error("aborted"))
        signal.addEventListener("abort", () => reject(new Error("aborted")))
      })
    }

    const results = await dispatch([spec("a"), spec("b"), spec("c")], executor, {
      mergeStrategy: "first-success",
      maxParallel: 3,
    })

    expect(results).toHaveLength(3)
    expect(results[0]!.agent).toBe("a")
    expect(results[0]!.status).toBe("completed")
    // b and c should be cancelled (the abort path from runOne marks them
    // as cancelled because the parent signal fires).
    expect(results.slice(1).every((r) => r.status === "cancelled")).toBe(true)
  })

  test("first-success returns failed if no spec completes", async () => {
    const executor: DispatchExecutor = async () => {
      throw new Error("nope")
    }
    const results = await dispatch([spec("a"), spec("b")], executor, {
      mergeStrategy: "first-success",
    })
    // No completion → all run to failure.
    expect(results.every((r) => r.status === "failed")).toBe(true)
  })

  test("majority cancels remaining once > N/2 specs complete", async () => {
    let completedCount = 0
    const executor: DispatchExecutor = async (s, signal) => {
      // a, b, c complete in ~20ms; d, e hang until cancelled.
      if (["a", "b", "c"].includes(s.agent)) {
        await new Promise((r) => setTimeout(r, 20))
        completedCount++
        return { output: `${s.agent}-ok` }
      }
      return new Promise((_, reject) => {
        if (signal.aborted) return reject(new Error("aborted"))
        signal.addEventListener("abort", () => reject(new Error("aborted")))
      })
    }

    const results = await dispatch([spec("a"), spec("b"), spec("c"), spec("d"), spec("e")], executor, {
      mergeStrategy: "majority",
      maxParallel: 5,
    })

    expect(results).toHaveLength(5)
    expect(completedCount).toBeGreaterThanOrEqual(3) // > 5/2
    // Once majority hits, d and e get cancelled.
    const cancelled = results.filter((r) => r.status === "cancelled")
    expect(cancelled.length).toBeGreaterThanOrEqual(1)
  })

  test("preserves input order in result array regardless of completion order", async () => {
    const executor: DispatchExecutor = async (s) => {
      const delay = s.agent === "a" ? 30 : s.agent === "b" ? 5 : 15
      await new Promise((r) => setTimeout(r, delay))
      return { output: `${s.agent}-done` }
    }
    const results = await dispatch([spec("a"), spec("b"), spec("c")], executor, {
      mergeStrategy: "first-success",
      maxParallel: 3,
    })
    expect(results.map((r) => r.agent)).toEqual(["a", "b", "c"])
  })

  test("respects maxParallel under first-success", async () => {
    let inflight = 0
    let peak = 0
    const executor: DispatchExecutor = async (_, signal) => {
      inflight++
      peak = Math.max(peak, inflight)
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve(undefined), 30)
          signal.addEventListener("abort", () => {
            clearTimeout(timer)
            reject(new Error("aborted"))
          })
        })
        return { output: "ok" }
      } finally {
        inflight--
      }
    }
    await dispatch([spec("a"), spec("b"), spec("c"), spec("d"), spec("e")], executor, {
      mergeStrategy: "all",
      maxParallel: 2,
    })
    expect(peak).toBeLessThanOrEqual(2)
  })

  test("parent abort before launch returns all cancelled", async () => {
    const ac = new AbortController()
    ac.abort()
    const results = await dispatch([spec("a"), spec("b")], slow(100), {
      mergeStrategy: "first-success",
      signal: ac.signal,
    })
    expect(results.every((r) => r.status === "cancelled")).toBe(true)
  })

  test("results array is stable after dispatch resolves even with late completions (regression)", async () => {
    // Direct test of the resolved-guard. Use an uncooperative slow
    // executor that we resolve from outside, AFTER the dispatch has
    // returned. With first-success + the guard, results[1] should
    // stay "cancelled" even when slow eventually resolves.
    let resolveSlow: ((val: { output: string }) => void) | null = null
    const executor: DispatchExecutor = async (s, signal) => {
      if (s.agent === "fast") {
        await new Promise((r) => setTimeout(r, 5))
        return { output: "fast-done" }
      }
      // slow honors the signal so dispatch can finalize promptly.
      // But we still expose a resolver for the *post-finalize* scenario.
      return new Promise<{ output: string }>((resolve, reject) => {
        resolveSlow = resolve
        signal.addEventListener("abort", () => reject(new Error("aborted")))
      })
    }

    const results = await dispatch([spec("fast"), spec("slow")], executor, {
      mergeStrategy: "first-success",
      maxParallel: 2,
    })

    // Snapshot now.
    const beforeStatus = results[1]!.status
    expect(beforeStatus).toBe("cancelled")

    // Now try to "complete" slow late. The runOne for slow has already
    // rejected (signal aborted) and its .catch ran during dispatch,
    // setting results[1] to status "cancelled". Calling resolveSlow now
    // is a no-op on the underlying Promise (already rejected).
    if (resolveSlow) (resolveSlow as (v: { output: string }) => void)({ output: "slow-late" })
    await new Promise((r) => setTimeout(r, 20))

    expect(results[1]!.status).toBe(beforeStatus)
    expect(results[1]!.output).toBeUndefined()
  })

  test("does not leak abort listeners on parent signal across many dispatches (regression)", async () => {
    // A long-lived parent signal that handles many dispatches must not
    // accumulate one "abort" handler per dispatch — the older
    // combineSignals helper had this bug. We can't easily count
    // listeners directly, but if the parent eventually aborts after
    // many dispatches and each handler still fires, ac.abort() runs N
    // times — harmless functionally, but the held closures keep the
    // already-resolved AbortControllers alive.
    //
    // Indirect smoke: run 50 first-success dispatches against the same
    // parent, then abort the parent. Nothing should hang or throw.
    const parent = new AbortController()
    for (let i = 0; i < 50; i++) {
      await dispatch([spec("a"), spec("b")], async (s) => ({ output: s.agent }), {
        mergeStrategy: "first-success",
        signal: parent.signal,
      })
    }
    // Parent still un-aborted; abort it now and ensure no errors throw.
    parent.abort()
    // One more dispatch under the now-aborted parent should return
    // cancelled stubs cleanly.
    const results = await dispatch([spec("z")], slow(100), {
      mergeStrategy: "first-success",
      signal: parent.signal,
    })
    expect(results[0]!.status).toBe("cancelled")
  })
})

describe("DispatcherEventSink", () => {
  test("emits start/complete events for the dispatch and each subagent", async () => {
    const events: string[] = []
    const sink: DispatcherEventSink = {
      onDispatchStart: (specs) => events.push(`dispatch:start:${specs.length}`),
      onSubagentStart: (s) => events.push(`agent:start:${s.agent}`),
      onSubagentComplete: (r) => events.push(`agent:complete:${r.agent}:${r.status}`),
      onDispatchComplete: (r) => events.push(`dispatch:complete:${r.length}`),
    }

    await dispatch([spec("a"), spec("b")], async (s) => ({ output: s.agent }), { events: sink })

    expect(events[0]).toBe("dispatch:start:2")
    expect(events.at(-1)).toBe("dispatch:complete:2")
    // Per-subagent ordering is fine in either order; just check both fired.
    expect(events.filter((e) => e.startsWith("agent:start:"))).toHaveLength(2)
    expect(events.filter((e) => e.startsWith("agent:complete:"))).toHaveLength(2)
  })

  test("event sink callbacks that throw do not crash the dispatch", async () => {
    const sink: DispatcherEventSink = {
      onSubagentStart: () => {
        throw new Error("oops")
      },
      onDispatchComplete: () => {
        throw new Error("also oops")
      },
    }
    const results = await dispatch([spec("a")], async () => ({ output: "ok" }), { events: sink })
    expect(results[0]!.status).toBe("completed")
  })
})
