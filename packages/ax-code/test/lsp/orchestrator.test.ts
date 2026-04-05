import { describe, expect, test } from "bun:test"
import { LSP } from "../../src/lsp"

describe("LSP.computeBackoff", () => {
  test("returns base delay for first failure", () => {
    // 30s base, first attempt
    expect(LSP.computeBackoff(1)).toBe(30_000)
  })

  test("quadruples on each subsequent failure", () => {
    expect(LSP.computeBackoff(2)).toBe(120_000) // 2m
    expect(LSP.computeBackoff(3)).toBe(480_000) // 8m
    expect(LSP.computeBackoff(4)).toBe(1_920_000) // 32m
  })

  test("caps at the configured maximum", () => {
    // 60m cap. At failure 5 the raw value would be 128m (8m * 16 = 128m),
    // which exceeds the cap.
    const cap = 60 * 60 * 1000
    expect(LSP.computeBackoff(5)).toBe(cap)
    expect(LSP.computeBackoff(6)).toBe(cap)
    expect(LSP.computeBackoff(100)).toBe(cap)
  })

  test("is monotonically non-decreasing", () => {
    let prev = 0
    for (let i = 1; i <= 20; i++) {
      const curr = LSP.computeBackoff(i)
      expect(curr).toBeGreaterThanOrEqual(prev)
      prev = curr
    }
  })
})

describe("LSP.markBroken / LSP.isBroken", () => {
  test("unmarked key is not broken", () => {
    const broken = new Map<string, LSP.BrokenEntry>()
    expect(LSP.isBroken(broken, "root:typescript")).toBe(false)
  })

  test("newly marked key is broken", () => {
    const broken = new Map<string, LSP.BrokenEntry>()
    LSP.markBroken(broken, "root:typescript")
    expect(LSP.isBroken(broken, "root:typescript")).toBe(true)
    expect(broken.get("root:typescript")?.failures).toBe(1)
  })

  test("repeat markBroken increments failure count and extends backoff", () => {
    const broken = new Map<string, LSP.BrokenEntry>()
    LSP.markBroken(broken, "key")
    const first = broken.get("key")!
    LSP.markBroken(broken, "key")
    const second = broken.get("key")!
    expect(second.failures).toBe(2)
    // Second failure schedules a later nextAttempt than the first
    expect(second.nextAttempt).toBeGreaterThan(first.nextAttempt)
  })

  test("isBroken drops expired entries and returns false", () => {
    const broken = new Map<string, LSP.BrokenEntry>()
    // Hand-construct an expired entry (nextAttempt in the past)
    broken.set("key", { failures: 1, nextAttempt: Date.now() - 1000 })
    expect(LSP.isBroken(broken, "key")).toBe(false)
    // Entry should have been removed so the next spawn can retry fresh
    expect(broken.has("key")).toBe(false)
  })

  test("isBroken leaves non-expired entries in place", () => {
    const broken = new Map<string, LSP.BrokenEntry>()
    broken.set("key", { failures: 1, nextAttempt: Date.now() + 60_000 })
    expect(LSP.isBroken(broken, "key")).toBe(true)
    expect(broken.has("key")).toBe(true)
  })

  test("isBroken does not affect other keys when an entry expires", () => {
    const broken = new Map<string, LSP.BrokenEntry>()
    broken.set("expired", { failures: 1, nextAttempt: Date.now() - 1000 })
    broken.set("fresh", { failures: 1, nextAttempt: Date.now() + 60_000 })
    expect(LSP.isBroken(broken, "expired")).toBe(false)
    expect(LSP.isBroken(broken, "fresh")).toBe(true)
    expect(broken.has("expired")).toBe(false)
    expect(broken.has("fresh")).toBe(true)
  })

  test("backoff compounds correctly across several failures", () => {
    const broken = new Map<string, LSP.BrokenEntry>()
    LSP.markBroken(broken, "key")
    expect(broken.get("key")?.failures).toBe(1)

    LSP.markBroken(broken, "key")
    expect(broken.get("key")?.failures).toBe(2)

    LSP.markBroken(broken, "key")
    expect(broken.get("key")?.failures).toBe(3)

    // After 3 failures the backoff should match computeBackoff(3) = 8 minutes
    const entry = broken.get("key")!
    const expectedBackoff = LSP.computeBackoff(3)
    const actualBackoff = entry.nextAttempt - Date.now()
    // Allow ~50ms of clock drift between the markBroken call and this assert
    expect(actualBackoff).toBeLessThanOrEqual(expectedBackoff)
    expect(actualBackoff).toBeGreaterThan(expectedBackoff - 50)
  })
})
