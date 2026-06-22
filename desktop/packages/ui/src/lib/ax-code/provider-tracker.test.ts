import { describe, expect, test } from "vitest"
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
})
