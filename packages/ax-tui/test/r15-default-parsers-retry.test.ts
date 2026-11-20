import { describe, expect, test, vi } from "vitest"

const state = vi.hoisted(() => ({ calls: 0 }))

vi.mock("../src/platform/runtime.js", () => ({
  resolveBundledFilePath: async () => {
    state.calls++
    if (state.calls === 1) throw new Error("asset resolution failed")
    return `/asset/${state.calls}`
  },
}))

import { getParsers } from "../src/lib/tree-sitter/default-parsers.js"

describe("r15 default-parsers retry", () => {
  test("G6: a failed first load does not poison the cache; the next call retries", async () => {
    await expect(getParsers()).rejects.toThrow("asset resolution failed")
    const parsers = await getParsers()
    expect(parsers).toHaveLength(4)
    expect(state.calls).toBe(10)
  })

  test("G6: a successful load stays cached", async () => {
    const first = getParsers()
    expect(getParsers()).toBe(first)
    await first
    expect(state.calls).toBe(10)
  })
})