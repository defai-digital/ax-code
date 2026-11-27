import { describe, expect, test } from "vitest"
import { checkReadmeSnippets, toPosix } from "../script/check-readme-snippets.js"

describe("README snippets", () => {
  test("every ```ts fence type-checks", () => {
    const result = checkReadmeSnippets()
    expect(result.snippets).toBeGreaterThan(0)
    expect(result.diagnostics.map((d) => `README.md:${d.readmeLine} - error TS${d.code}: ${d.message}`)).toEqual([])
  })

  test("normalizes Windows-style virtual paths to forward slashes", () => {
    expect(toPosix("C:\\repo\\packages\\sdk\\js\\__readme_snippet_0.ts")).toBe(
      "C:/repo/packages/sdk/js/__readme_snippet_0.ts",
    )
    expect(toPosix("/already/posix.ts")).toBe("/already/posix.ts")
  })
})
