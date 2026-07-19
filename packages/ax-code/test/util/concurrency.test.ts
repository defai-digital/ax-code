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
    // Regression for: release() decremented then woke a waiter who re-incremented;
    // a synchronous free-path run() between those steps could also acquire → peak=2
    // on max=1.
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

    // Holder owns the only permit and waits for an external signal.
    const holder = limiter.run(async () => {
      await track(1)
      await hold
    })

    // Waiter is queued while the permit is held.
    const waiter = limiter.run(async () => {
      await track(5)
    })
    // Ensure the waiter is parked (not free-path).
    await new Promise((r) => setTimeout(r, 5))
    expect(limiter.waiting()).toBe(1)
    expect(limiter.active()).toBe(1)

    // Free the holder. Its release must hand the permit to the waiter without
    // opening a slot that a concurrent free-path run() can take.
    releaseHold()
    // Synchronously race a free-path acquire before the waiter microtask runs.
    const racer = limiter.run(async () => {
      await track(5)
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
