import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { clearCopyResetTimer, replaceCopyResetTimer } from "./copyResetTimer"

describe("copy reset timers", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("replaces an existing reset timer so only the latest copy expires", () => {
    const reset = vi.fn()
    const first = replaceCopyResetTimer(null, reset, 100)
    replaceCopyResetTimer(first, reset, 200)

    vi.advanceTimersByTime(100)
    expect(reset).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it("clears a pending reset timer during cleanup", () => {
    const reset = vi.fn()
    const timer = replaceCopyResetTimer(null, reset, 100)

    expect(clearCopyResetTimer(timer)).toBeNull()
    vi.advanceTimersByTime(100)

    expect(reset).not.toHaveBeenCalled()
  })
})
