import { describe, expect, test } from "vitest"
import { levenshtein } from "../../src/util/levenshtein"

describe("levenshtein", () => {
  test("computes the edit distance", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3)
    expect(levenshtein("", "abc")).toBe(3)
  })

  test("identical strings above the length cap are distance zero", () => {
    const line = "x".repeat(2_001)
    expect(levenshtein(line, line)).toBe(0)
    expect(levenshtein(line, "y")).toBe(2_001)
  })
})
