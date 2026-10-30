import { describe, expect, test, vi } from "vitest"
import { ManualClock } from "../src/testing/manual-clock.js"

describe("ManualClock", () => {
  test.each([0, 5])("an interval can cancel itself at delay %i", (delay) => {
    const clock = new ManualClock()
    const fn = vi.fn(() => clock.clearInterval(handle))
    const handle = clock.setInterval(fn, delay)

    clock.advance(20)
    clock.advance(20)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  test("runAll finishes after an interval cancels itself", () => {
    const clock = new ManualClock()
    const fn = vi.fn(() => clock.clearInterval(handle))
    const handle = clock.setInterval(fn, 5)

    // Advance first so a broken cancellation fails without hanging runAll.
    clock.advance(10)
    expect(fn).toHaveBeenCalledTimes(1)
    clock.runAll()
    expect(clock.now()).toBe(10)
  })

  test("a pending zero-delay interval never moves time backwards", () => {
    const clock = new ManualClock()
    const times: number[] = []
    clock.setInterval(() => times.push(clock.now()), 0)

    clock.advance(5)
    clock.advance(5)
    expect(times).toEqual([0, 5])
    expect(clock.now()).toBe(10)
  })

  test("a zero-delay interval fires once per advance instead of looping forever", () => {
    const clock = new ManualClock()
    const fn = vi.fn()
    clock.setInterval(fn, 0)

    clock.advance(1)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(clock.now()).toBe(1)

    clock.advance(1)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  test("other timers due in the same advance still fire after a zero-delay interval", () => {
    const clock = new ManualClock()
    const order: string[] = []
    clock.setInterval(() => order.push("interval"), 0)
    clock.setTimeout(() => order.push("timeout"), 1)

    clock.advance(5)

    expect(order).toEqual(["interval", "timeout"])
    expect(clock.now()).toBe(5)
  })
})
