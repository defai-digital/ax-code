import { describe, expect, test } from "vitest"

import { DEFAULT_DIRECTORY_CACHE_KEY, getDirectoryCacheKey } from "./cacheKey"

describe("getDirectoryCacheKey", () => {
  test("uses trimmed directory values", () => {
    expect(getDirectoryCacheKey(" /repo ")).toBe("/repo")
  })

  test("falls back for missing or blank directories", () => {
    expect(getDirectoryCacheKey(null)).toBe(DEFAULT_DIRECTORY_CACHE_KEY)
    expect(getDirectoryCacheKey(undefined)).toBe(DEFAULT_DIRECTORY_CACHE_KEY)
    expect(getDirectoryCacheKey("   ")).toBe(DEFAULT_DIRECTORY_CACHE_KEY)
  })
})
