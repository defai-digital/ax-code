import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { createDeferredDisposer } from "../../../src/cli/tui/context/deferred-disposer"

function fakeStyle() {
  let destroys = 0
  return {
    destroy: () => {
      destroys += 1
    },
    destroys: () => destroys,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("createDeferredDisposer", () => {
  test("destroys a superseded instance exactly once after the deferral, never the current one", () => {
    const disposer = createDeferredDisposer()
    const first = fakeStyle()
    const second = fakeStyle()

    disposer.track(first)
    disposer.track(second)
    expect(first.destroys()).toBe(0)
    expect(second.destroys()).toBe(0)

    vi.runAllTimers()
    expect(first.destroys()).toBe(1)
    expect(second.destroys()).toBe(0)

    vi.runAllTimers()
    expect(first.destroys()).toBe(1)
    expect(second.destroys()).toBe(0)
  })

  test("destroys every superseded instance in a rapid sequence, keeping only the latest", () => {
    const disposer = createDeferredDisposer()
    const styles = [fakeStyle(), fakeStyle(), fakeStyle()]
    for (const style of styles) disposer.track(style)

    vi.runAllTimers()
    expect(styles[0].destroys()).toBe(1)
    expect(styles[1].destroys()).toBe(1)
    expect(styles[2].destroys()).toBe(0)
  })

  test("tracking the same instance again does not destroy it", () => {
    const disposer = createDeferredDisposer()
    const style = fakeStyle()

    disposer.track(style)
    disposer.track(style)
    vi.runAllTimers()
    expect(style.destroys()).toBe(0)
  })

  test("an instance that becomes current again is not destroyed by its earlier schedule", () => {
    const disposer = createDeferredDisposer()
    const first = fakeStyle()
    const second = fakeStyle()

    disposer.track(first)
    disposer.track(second)
    disposer.track(first)
    vi.runAllTimers()
    expect(first.destroys()).toBe(0)
    expect(second.destroys()).toBe(1)
  })

  test("a reused instance receives a full new grace period after it is superseded again", () => {
    const disposer = createDeferredDisposer()
    const first = fakeStyle()
    const second = fakeStyle()
    const third = fakeStyle()
    disposer.track(first)
    disposer.track(second)
    vi.advanceTimersByTime(400)
    disposer.track(first)
    vi.advanceTimersByTime(400)
    disposer.track(third)
    vi.advanceTimersByTime(200)
    expect(first.destroys()).toBe(0)
    vi.advanceTimersByTime(799)
    expect(first.destroys()).toBe(0)
    vi.advanceTimersByTime(1)
    expect(first.destroys()).toBe(1)
    expect(third.destroys()).toBe(0)
  })

  test("dispose destroys the pending and current instances exactly once", () => {
    const disposer = createDeferredDisposer()
    const first = fakeStyle()
    const second = fakeStyle()

    disposer.track(first)
    disposer.track(second)
    disposer.dispose()
    expect(first.destroys()).toBe(1)
    expect(second.destroys()).toBe(1)
    expect(vi.getTimerCount()).toBe(0)

    // The deferred callback and a repeated dispose must not destroy again.
    vi.runAllTimers()
    disposer.dispose()
    expect(first.destroys()).toBe(1)
    expect(second.destroys()).toBe(1)
  })

  test("dispose cleans every other instance even when one destroy throws", () => {
    const disposer = createDeferredDisposer()
    const failure = new Error("native destroy failed")
    const first = {
      destroy: () => {
        throw failure
      },
    }
    const second = fakeStyle()
    disposer.track(first)
    disposer.track(second)
    expect(() => disposer.dispose()).toThrow(failure)
    expect(second.destroys()).toBe(1)
    expect(() => vi.runAllTimers()).not.toThrow()
    expect(() => disposer.dispose()).not.toThrow()
  })

  test("dispose with nothing tracked is a no-op", () => {
    const disposer = createDeferredDisposer()
    expect(() => disposer.dispose()).not.toThrow()
    vi.runAllTimers()
  })
})
