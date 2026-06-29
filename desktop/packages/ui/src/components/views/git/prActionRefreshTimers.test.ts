import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { clearPrActionRefreshTimers, replacePrActionRefreshTimers } from "./prActionRefreshTimers"

describe("PR action refresh timers", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("clears pending timers before scheduling replacements", () => {
    const refreshes: string[] = []
    const firstTimers = replacePrActionRefreshTimers([], [50, 100], () => refreshes.push("first"))
    replacePrActionRefreshTimers(firstTimers, [75], () => refreshes.push("second"))

    vi.advanceTimersByTime(100)

    expect(refreshes).toEqual(["second"])
  })

  it("clears the latest timer array on cleanup", () => {
    const refresh = vi.fn()
    const timersRef = { current: replacePrActionRefreshTimers([], [25, 50], refresh) }

    clearPrActionRefreshTimers(timersRef.current)
    timersRef.current = []
    vi.advanceTimersByTime(50)

    expect(refresh).not.toHaveBeenCalled()
  })
})
