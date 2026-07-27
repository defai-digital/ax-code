import { describe, expect, test, vi } from "vitest"
import { recordProviderError, recordProviderSuccess, isCircuitOpen } from "./provider-tracker"

describe("provider-tracker circuit breaker", () => {
  test("a proven success closes an open circuit immediately", () => {
    // Unique id per test — the tracker keeps module-level per-provider state.
    const provider = "test-provider-success-closes"

    // Three consecutive retryable errors trip the breaker.
    recordProviderError(provider, 503)
    recordProviderError(provider, 503)
    recordProviderError(provider, 503)
    expect(isCircuitOpen(provider)).toBe(true)

    // A success means the provider recovered — the circuit must reopen for
    // traffic now, not after the full cooldown.
    recordProviderSuccess(provider)
    expect(isCircuitOpen(provider)).toBe(false)
  })

  test("non-retryable errors do not open the circuit", () => {
    const provider = "test-provider-non-retryable"
    recordProviderError(provider, 400)
    recordProviderError(provider, 400)
    recordProviderError(provider, 400)
    expect(isCircuitOpen(provider)).toBe(false)
  })

  test("eviction interval starts lazily on the first tracked provider", async () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval")
    try {
      // Fresh module instance so import-time side effects can be observed.
      vi.resetModules()
      const tracker = await import("./provider-tracker")
      expect(setIntervalSpy).not.toHaveBeenCalled()

      tracker.recordProviderError("test-provider-lazy-interval", 503)
      expect(setIntervalSpy).toHaveBeenCalledTimes(1)

      // Tracking another provider must not start a second interval.
      tracker.recordProviderError("test-provider-lazy-interval-2", 503)
      expect(setIntervalSpy).toHaveBeenCalledTimes(1)
    } finally {
      setIntervalSpy.mockRestore()
    }
  })
})
