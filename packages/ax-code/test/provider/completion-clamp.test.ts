import { describe, expect, test } from "vitest"
import { completionClamp, calculateCompactionBudget, OUTPUT_FLOOR } from "@/session/compaction-budget"

const CONTEXT = 200_000
const STATIC_CEILING = 32_000

describe("completionClamp", () => {
  test("clamps to the remaining window (context - used - reserve)", () => {
    expect(
      completionClamp({ context: CONTEXT, used: 170_000, reserve: 20_000, staticCeiling: STATIC_CEILING }),
    ).toBe(10_000)
  })

  test("static per-provider ceilings stay the outer bound", () => {
    expect(completionClamp({ context: CONTEXT, used: 10_000, reserve: 20_000, staticCeiling: STATIC_CEILING })).toBe(
      STATIC_CEILING,
    )
    expect(
      completionClamp({ context: CONTEXT, used: 10_000, reserve: 20_000, staticCeiling: 5_000 }),
    ).toBe(5_000)
  })

  test("cache reads occupy the window via the used figure", () => {
    const withoutCache = completionClamp({
      context: CONTEXT,
      used: 100_000,
      reserve: 20_000,
      staticCeiling: 100_000,
    })
    const withCache = completionClamp({
      context: CONTEXT,
      used: 100_000 + 30_000, // cache read tokens included in used
      reserve: 20_000,
      staticCeiling: 100_000,
    })
    expect(withCache).toBe(withoutCache! - 30_000)
  })

  test("returns undefined at or below the output floor (prefer compaction)", () => {
    expect(
      completionClamp({
        context: CONTEXT,
        used: CONTEXT - OUTPUT_FLOOR - 20_000,
        reserve: 20_000,
        staticCeiling: STATIC_CEILING,
      }),
    ).toBeUndefined()
    expect(
      completionClamp({ context: CONTEXT, used: CONTEXT - 20_000, reserve: 20_000, staticCeiling: STATIC_CEILING }),
    ).toBeUndefined()
  })

  test("returns undefined when the model declares no context window", () => {
    expect(completionClamp({ context: 0, used: 0, reserve: 0, staticCeiling: STATIC_CEILING })).toBeUndefined()
  })

  test("the floor boundary itself is one token above OUTPUT_FLOOR", () => {
    const value = completionClamp({
      context: CONTEXT,
      used: CONTEXT - OUTPUT_FLOOR - 1 - 20_000,
      reserve: 20_000,
      staticCeiling: STATIC_CEILING,
    })
    expect(value).toBe(OUTPUT_FLOOR + 1)
  })
})

describe("reserve sharing between compaction and the clamp", () => {
  test("the clamp consumes the same reserve the compaction budget reserves", () => {
    const model = { providerID: "anthropic", limit: { context: CONTEXT, output: 8_000 } }
    const budget = calculateCompactionBudget(model)!
    expect(budget.reserved).toBe(20_000)
    // One reserve pool: the clamp subtracts exactly budget.reserved, not a
    // second, independently-derived reserve.
    const clamped = completionClamp({
      context: CONTEXT,
      used: 150_000,
      reserve: budget.reserved,
      staticCeiling: STATIC_CEILING,
    })
    expect(clamped).toBe(CONTEXT - 150_000 - budget.reserved)
  })

  test("an explicit compaction.reserved config value is the shared reserve", () => {
    const model = { providerID: "anthropic", limit: { context: CONTEXT, output: 8_000 } }
    const budget = calculateCompactionBudget(model, 50_000)!
    expect(budget.reserved).toBe(50_000)
    const clamped = completionClamp({
      context: CONTEXT,
      used: 100_000,
      reserve: budget.reserved,
      staticCeiling: 100_000,
    })
    expect(clamped).toBe(CONTEXT - 100_000 - 50_000)
  })
})
