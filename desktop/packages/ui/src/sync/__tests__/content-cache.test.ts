import { afterEach, describe, expect, test } from "vitest"

import { evictContentLru, getContentEntryCount, hasContent, resetContentLru, setContentBytes } from "../content-cache"

afterEach(() => {
  resetContentLru()
})

describe("evictContentLru", () => {
  test("keeps evicting past a protected entry even when `keep` also lists paths that aren't cached", () => {
    // `keep` legitimately represents "paths that must survive" (e.g. open
    // tabs), which is a broader set than "paths currently in the LRU". Only
    // one of the 43 populated paths is actually protected; the rest of
    // `keep` are tabs that were never read into this cache.
    setContentBytes("protected-1", 10)
    for (let i = 0; i < 42; i += 1) {
      setContentBytes(`unprotected-${i}`, 10)
    }
    expect(getContentEntryCount()).toBe(43)

    const keep = new Set<string>(["protected-1"])
    for (let i = 0; i < 50; i += 1) keep.add(`open-tab-not-yet-read-${i}`)

    const evicted: string[] = []
    evictContentLru(keep, (path) => evicted.push(path))

    // The 40-entry cap must still be enforced — the inflated `keep.size`
    // must not fool the eviction loop into stopping immediately.
    expect(getContentEntryCount()).toBeLessThanOrEqual(40)
    expect(evicted.length).toBeGreaterThanOrEqual(3)
    expect(hasContent("protected-1")).toBe(true)
    expect(evicted).not.toContain("protected-1")
  })

  test("stops without an infinite loop once every cached entry is protected", () => {
    for (let i = 0; i < 41; i += 1) setContentBytes(`protected-${i}`, 10)
    const keep = new Set<string>(Array.from({ length: 41 }, (_, i) => `protected-${i}`))

    const evicted: string[] = []
    evictContentLru(keep, (path) => evicted.push(path))

    expect(evicted).toEqual([])
    expect(getContentEntryCount()).toBe(41)
  })
})
