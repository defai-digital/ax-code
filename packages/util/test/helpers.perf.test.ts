import { describe, expect, test } from "vitest"
import { stringList, uniqueStrings, uniqueSortedStrings } from "../src/string-list"
import { sleep, withTimeout } from "../src/unref-timeout"

// Generous no-regression budget: this asserts the consolidated helpers do not
// collapse catastrophically (e.g. an accidental O(n^2) rewrite), not that they
// win a micro-benchmark. Override with HELPERS_PERF_BUDGET_MS on very slow hosts.
const BUDGET_MS = Number(process.env.HELPERS_PERF_BUDGET_MS ?? 2000)
const N = 100_000

function mixedStrings(): string[] {
  return Array.from({ length: N }, (_, i) => `item-${i % 1000}`)
}

describe("consolidated helper performance", () => {
  test(`stringList over ${N} items stays within ${BUDGET_MS}ms`, () => {
    const input = Array.from({ length: N }, (_, i) => (i % 7 === 0 ? i : `s-${i}`)) as unknown[]
    const start = performance.now()
    const out = stringList(input)
    const elapsed = performance.now() - start
    expect(out.length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(BUDGET_MS)
  })

  test(`uniqueStrings over ${N} items stays within ${BUDGET_MS}ms`, () => {
    const input = mixedStrings()
    const start = performance.now()
    const out = uniqueStrings(input)
    const elapsed = performance.now() - start
    expect(out).toHaveLength(1000)
    expect(elapsed).toBeLessThan(BUDGET_MS)
  })

  test(`uniqueSortedStrings over ${N} items stays within ${BUDGET_MS}ms`, () => {
    const input = mixedStrings()
    const start = performance.now()
    const out = uniqueSortedStrings(input)
    const elapsed = performance.now() - start
    expect(out).toHaveLength(1000)
    expect(elapsed).toBeLessThan(BUDGET_MS)
  })

  test(`sleep resolves within ${BUDGET_MS}ms`, async () => {
    const start = performance.now()
    await sleep(1)
    expect(performance.now() - start).toBeLessThan(BUDGET_MS)
  })

  test(`withTimeout fast path resolves within ${BUDGET_MS}ms`, async () => {
    const start = performance.now()
    const value = await withTimeout(Promise.resolve("ok"), 60_000)
    expect(value).toBe("ok")
    expect(performance.now() - start).toBeLessThan(BUDGET_MS)
  })
})
