import { describe, expect, test } from "vitest"
import { createConcurrencyLimiter, mapWithConcurrency } from "../../src/util/concurrency"

describe("createConcurrencyLimiter", () => {
  test("never exceeds max concurrent permits", async () => {
    const limiter = createConcurrencyLimiter(2)
    let inFlight = 0
    let peak = 0
    const work = async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 20))
      inFlight -= 1
    }

    await Promise.all(Array.from({ length: 8 }, () => limiter.run(work)))
    expect(peak).toBeLessThanOrEqual(2)
    expect(limiter.active()).toBe(0)
    expect(limiter.waiting()).toBe(0)
  })

  test("clamps non-positive max to 1", async () => {
    const limiter = createConcurrencyLimiter(0)
    expect(limiter.max).toBe(1)
    let ran = false
    await limiter.run(async () => {
      ran = true
    })
    expect(ran).toBe(true)
  })

  test("releases the permit when the work function rejects", async () => {
    const limiter = createConcurrencyLimiter(1)
    await expect(
      limiter.run(async () => {
        throw new Error("boom")
      }),
    ).rejects.toThrow("boom")
    expect(limiter.active()).toBe(0)
    let second = false
    await limiter.run(async () => {
      second = true
    })
    expect(second).toBe(true)
  })

  test("release handoff never lets a free-path acquire steal the permit", async () => {
    // Regression for the open-slot race on max=1:
    //   release: active--; wake waiter
    //   free-path acquire: active++  (steals the open slot)
    //   waiter resume: active++      → peak 2
    //
    // Free-path steal exists only AFTER the holder's finally/release runs and
    // BEFORE the woken waiter re-acquires. Calling free-path run() in the same
    // turn as releaseHold() is too early (holder still owns the permit). Holder
    // body must finish immediately after releaseHold so finally/release runs in
    // the next microtask; then free-path races before the waiter resumes.
    const limiter = createConcurrencyLimiter(1)
    let inFlight = 0
    let peak = 0
    let activePeak = 0
    const track = async (ms: number) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      activePeak = Math.max(activePeak, limiter.active())
      await new Promise((r) => setTimeout(r, ms))
      inFlight -= 1
    }

    let releaseHold!: () => void
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve
    })

    // Holder: wait only — no async work after the gate so finally/release runs
    // in the same microtask turn that resumes after hold resolves.
    const holder = limiter.run(async () => {
      await hold
    })

    const waiter = limiter.run(async () => {
      await track(15)
    })
    await new Promise((r) => setTimeout(r, 5))
    expect(limiter.waiting()).toBe(1)
    expect(limiter.active()).toBe(1)

    releaseHold()
    // Drain holder completion + finally/release. Waiter's re-acquire is still
    // a later microtask on the buggy algorithm (active-- then wake).
    await Promise.resolve()
    await Promise.resolve()

    // Open-slot window: old algorithm has active=0 here so free-path steals;
    // handoff keeps active=1 (permit already transferred) so free-path queues.
    const racer = limiter.run(async () => {
      await track(15)
    })

    await Promise.all([holder, waiter, racer])
    expect(peak).toBeLessThanOrEqual(1)
    expect(activePeak).toBeLessThanOrEqual(1)
    expect(limiter.active()).toBe(0)
    expect(limiter.waiting()).toBe(0)
  })
})

describe("mapWithConcurrency", () => {
  test("preserves order and bounds concurrency", async () => {
    let inFlight = 0
    let peak = 0
    const result = await mapWithConcurrency([10, 20, 30, 40, 50], 2, async (n, index) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight -= 1
      return n + index
    })
    expect(result).toEqual([10, 21, 32, 43, 54])
    expect(peak).toBeLessThanOrEqual(2)
  })

  test("returns empty array for empty input", async () => {
    expect(await mapWithConcurrency([], 4, async (x) => x)).toEqual([])
  })
})
