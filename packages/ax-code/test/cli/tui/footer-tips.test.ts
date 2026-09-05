import { describe, expect, test } from "vitest"
import {
  createFooterTipCycle,
  FOOTER_TIPS,
  footerTipWidth,
} from "../../../src/cli/cmd/tui/component/prompt/footer-tips"

// Deterministic rng: cycles through a fixed fraction sequence so the shuffle
// order is pinned per test.
function fixedRng(values: number[]) {
  let index = 0
  return () => values[index++ % values.length]!
}

describe("createFooterTipCycle", () => {
  test("returns every index exactly once per full round", () => {
    const count = FOOTER_TIPS.length
    const cycle = createFooterTipCycle(count, fixedRng([0.99, 0.5, 0.25]))
    const seen = new Set<number>()
    for (let index = 0; index < count; index++) {
      const value = cycle.next()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(count)
      seen.add(value)
    }
    expect(seen.size).toBe(count)
  })

  test("round-robin repeats the same shuffled order every round", () => {
    const count = 5
    const rng = fixedRng([0.9, 0.7, 0.3, 0.1])
    const cycle = createFooterTipCycle(count, rng)
    const first = Array.from({ length: count }, () => cycle.next())
    const second = Array.from({ length: count }, () => cycle.next())
    expect(second).toEqual(first)
  })

  test("handles a single tip", () => {
    const cycle = createFooterTipCycle(1, fixedRng([0.5]))
    expect(cycle.next()).toBe(0)
    expect(cycle.next()).toBe(0)
  })
})

describe("footerTipWidth", () => {
  test("adds two columns of surrounding space to the tip length", () => {
    expect(footerTipWidth("abc")).toBe(5)
    expect(footerTipWidth("")).toBe(2)
  })
})

describe("FOOTER_TIPS", () => {
  test("has no duplicate entries", () => {
    expect(new Set(FOOTER_TIPS).size).toBe(FOOTER_TIPS.length)
  })
})
