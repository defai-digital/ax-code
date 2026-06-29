import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { clearOnboardingTimer, replaceOnboardingTimer } from "./onboardingTimers"

describe("onboarding timers", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("replaces existing feedback timers so only the latest one runs", () => {
    const reset = vi.fn()
    const first = replaceOnboardingTimer(null, reset, 100)
    replaceOnboardingTimer(first, reset, 200)

    vi.advanceTimersByTime(100)
    expect(reset).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it("clears pending feedback timers during cleanup", () => {
    const reset = vi.fn()
    const timer = replaceOnboardingTimer(null, reset, 100)

    expect(clearOnboardingTimer(timer)).toBeNull()
    vi.advanceTimersByTime(100)

    expect(reset).not.toHaveBeenCalled()
  })
})
