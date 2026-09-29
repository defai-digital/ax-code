import { describe, expect, test } from "vitest"
import { globToRegExp, matchesGlob } from "../src/glob.js"

describe("glob RegExp cache", () => {
  test("returns the same compiled instance for repeated patterns", () => {
    expect(globToRegExp("src/**/*.ts")).toBe(globToRegExp("src/**/*.ts"))
  })

  test("matching stays correct after the cache is flooded past its bound", () => {
    for (let index = 0; index < 300; index++) globToRegExp(`pattern-${index}/**`)
    expect(matchesGlob("src/a.ts", "src/*.ts")).toBe(true)
    expect(matchesGlob("src/deep/a.ts", "src/*.ts")).toBe(false)
    expect(matchesGlob("src/deep/a.ts", "src/**/*.ts")).toBe(true)
    expect(globToRegExp("src/**/*.ts")).toBe(globToRegExp("src/**/*.ts"))
  })
})
