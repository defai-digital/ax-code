import { describe, expect, test } from "vitest"
import { INTERNAL_ONLY_ROOTS, isInternalOnlyPath } from "./repository-policy"

describe("repository internal-only path policy", () => {
  test("recognizes the canonical internal root only", () => {
    expect(INTERNAL_ONLY_ROOTS).toEqual([".internal"])
    expect(isInternalOnlyPath(".internal")).toBe(true)
    expect(isInternalOnlyPath("./.internal/reports/qa/self-scan.md")).toBe(true)
    expect(isInternalOnlyPath(".internal/plan.md")).toBe(true)
    expect(isInternalOnlyPath("docs/internal.md")).toBe(false)
    expect(isInternalOnlyPath(".internalized/file.md")).toBe(false)
    expect(isInternalOnlyPath("ax-internal/plan.md")).toBe(false)
  })

  test("normalizes Windows separators", () => {
    expect(isInternalOnlyPath(".internal\\reports\\qa\\self-scan.md")).toBe(true)
  })
})
