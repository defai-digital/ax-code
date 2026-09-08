import { describe, expect, test } from "vitest"
import { calculateCompactionBudget, effectiveTokenTotal } from "@/session/compaction-budget"

describe("calculateCompactionBudget", () => {
  test("context-limited model reserves 10% of context", () => {
    const budget = calculateCompactionBudget({
      providerID: "anthropic",
      limit: { context: 200_000, output: 8_000 },
    })
    expect(budget).toEqual({ cap: 200_000, reserved: 20_000, usable: 180_000 })
  })

  test("input-limited model uses the input cap, not context", () => {
    const budget = calculateCompactionBudget({
      providerID: "anthropic",
      limit: { context: 200_000, input: 100_000, output: 8_000 },
    })
    expect(budget).toEqual({ cap: 100_000, reserved: 10_000, usable: 90_000 })
  })

  test("limit.input of 0 falls back to context", () => {
    const budget = calculateCompactionBudget({
      providerID: "anthropic",
      limit: { context: 200_000, input: 0, output: 8_000 },
    })
    expect(budget?.cap).toBe(200_000)
  })

  test("explicit reserved overrides the 10% default", () => {
    const budget = calculateCompactionBudget(
      { providerID: "anthropic", limit: { context: 200_000, output: 8_000 } },
      50_000,
    )
    expect(budget).toEqual({ cap: 200_000, reserved: 50_000, usable: 150_000 })
  })

  test("ax-engine without an input cap reserves at least the output limit", () => {
    const budget = calculateCompactionBudget({
      providerID: "ax-engine",
      limit: { context: 128_000, output: 32_000 },
    })
    expect(budget).toEqual({ cap: 128_000, reserved: 32_000, usable: 96_000 })
  })

  test("returns undefined when context limit is unknown", () => {
    expect(calculateCompactionBudget({ providerID: "x", limit: { context: 0, output: 0 } })).toBeUndefined()
  })
})

describe("effectiveTokenTotal", () => {
  const base = { input: 10, output: 5, reasoning: 2, cache: { read: 3, write: 1 } }

  test("prefers the provider-reported total when it covers the components", () => {
    expect(effectiveTokenTotal({ ...base, total: 100 })).toBe(100)
  })

  test("falls back to the component sum when total is missing or under-reported", () => {
    expect(effectiveTokenTotal(base)).toBe(21)
    expect(effectiveTokenTotal({ ...base, total: 10 })).toBe(21)
  })
})
