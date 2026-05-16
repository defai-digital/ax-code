import { describe, expect, test } from "bun:test"
import { diffSummary } from "@/cli/cmd/tui/routes/session/format"

describe("diffSummary", () => {
  test("returns undefined for empty diff", () => {
    expect(diffSummary("")).toBeUndefined()
    expect(diffSummary(undefined)).toBeUndefined()
  })

  test("returns undefined when nothing parseable", () => {
    // Plain text with no hunks, no +/- prefixes — e.g. a binary patch summary
    expect(diffSummary("Binary files differ\n")).toBeUndefined()
  })

  test("returns undefined for context-only patch (hunks but no +/- content)", () => {
    // Hunk header present, only context lines — no real change to surface
    const diff = ["--- a/x.ts", "+++ b/x.ts", "@@ -1,2 +1,2 @@", " line a", " line b"].join("\n")
    expect(diffSummary(diff)).toBeUndefined()
  })

  test("counts a single hunk with adds and removes", () => {
    const diff = [
      "--- a/foo.ts",
      "+++ b/foo.ts",
      "@@ -1,3 +1,3 @@",
      " context",
      "-old",
      "+new",
      "+extra",
    ].join("\n")
    expect(diffSummary(diff)).toEqual({ hunks: 1, added: 2, removed: 1 })
  })

  test("counts multiple hunks", () => {
    const diff = [
      "--- a/foo.ts",
      "+++ b/foo.ts",
      "@@ -1,2 +1,2 @@",
      "-a",
      "+b",
      "@@ -10,2 +10,2 @@",
      "-c",
      "+d",
      "@@ -20,1 +20,2 @@",
      "+e",
    ].join("\n")
    expect(diffSummary(diff)).toEqual({ hunks: 3, added: 3, removed: 2 })
  })

  test("excludes +++ and --- file headers from add/remove tallies", () => {
    const diff = ["--- a/x.ts", "+++ b/x.ts", "@@ -1,1 +1,1 @@", "-a", "+b"].join("\n")
    // 1 add, 1 remove — NOT 2/2 (the +++/--- lines must be skipped)
    expect(diffSummary(diff)).toEqual({ hunks: 1, added: 1, removed: 1 })
  })

  test("pure-add diff (new file)", () => {
    const diff = [
      "--- /dev/null",
      "+++ b/new.ts",
      "@@ -0,0 +1,3 @@",
      "+line a",
      "+line b",
      "+line c",
    ].join("\n")
    expect(diffSummary(diff)).toEqual({ hunks: 1, added: 3, removed: 0 })
  })
})
