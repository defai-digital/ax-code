import { describe, expect, test } from "vitest"
import { INTERNAL_ONLY_ROOTS, isInternalOnlyPath } from "./repository-policy"

describe("repository internal-only path policy", () => {
  test("keeps the current and legacy roots under the same policy", () => {
    expect(INTERNAL_ONLY_ROOTS).toEqual([".internal", "ax-internal"])
    expect(isInternalOnlyPath(".internal")).toBe(true)
    expect(isInternalOnlyPath("./.internal/reports/self-scan.md")).toBe(true)
    expect(isInternalOnlyPath("ax-internal/plan.md")).toBe(true)
    expect(isInternalOnlyPath("docs/internal.md")).toBe(false)
    expect(isInternalOnlyPath("ax-internalized/file.md")).toBe(false)
  })

  test("normalizes Windows separators", () => {
    expect(isInternalOnlyPath(".internal\\reports\\self-scan.md")).toBe(true)
    expect(isInternalOnlyPath("ax-internal\\plan.md")).toBe(true)
  })
})
