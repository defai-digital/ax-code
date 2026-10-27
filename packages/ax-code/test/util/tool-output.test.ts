import { describe, expect, test } from "vitest"

import { diffSummary } from "../../src/util/tool-output"

describe("diffSummary", () => {
  test("returns undefined for empty or signal-free input", () => {
    expect(diffSummary(undefined)).toBeUndefined()
    expect(diffSummary("")).toBeUndefined()
    expect(diffSummary("Binary files differ\n")).toBeUndefined()
    const contextOnly = ["--- a/x.ts", "+++ b/x.ts", "@@ -1,2 +1,2 @@", " line a", " line b"].join("\n")
    expect(diffSummary(contextOnly)).toBeUndefined()
  })

  test("ignores file headers outside a hunk", () => {
    const diff = ["--- a/f.ts", "+++ b/f.ts", "@@ -1,2 +1,2 @@", "-old", "+new", "+extra"].join("\n")
    expect(diffSummary(diff)).toEqual({ hunks: 1, added: 2, removed: 1 })
  })

  test("counts ---/+++ content lines inside a hunk as content, not headers", () => {
    // Removing the SQL comment `-- note` renders as the hunk line `--- note`,
    // and adding `++i;` renders as `+++i;`. Neither is a file header.
    const diff = ["--- a/f.sql", "+++ b/f.sql", "@@ -1 +1 @@", "--- note", "+++i;"].join("\n")
    expect(diffSummary(diff)).toEqual({ hunks: 1, added: 1, removed: 1 })
  })

  test("omitted @@ counts default to 1", () => {
    const diff = ["--- a/f.ts", "+++ b/f.ts", "@@ -1 +1 @@", "-old", "+new"].join("\n")
    expect(diffSummary(diff)).toEqual({ hunks: 1, added: 1, removed: 1 })
  })

  test("\\ No newline at end of file consumes no hunk line", () => {
    // Extent 2/2: if the marker consumed a line pair, `--- note` would fall
    // outside the hunk and be dropped as a file header.
    const diff = [
      "--- a/f.ts",
      "+++ b/f.ts",
      "@@ -1,2 +1,2 @@",
      " keep",
      "\\ No newline at end of file",
      "--- note",
      "+++i;",
    ].join("\n")
    expect(diffSummary(diff)).toEqual({ hunks: 1, added: 1, removed: 1 })
  })

  test("file headers between hunks of a multi-file patch are still skipped", () => {
    const diff = [
      "--- a/one.ts",
      "+++ b/one.ts",
      "@@ -1 +1 @@",
      "-old1",
      "+new1",
      "--- a/two.ts",
      "+++ b/two.ts",
      "@@ -1 +1 @@",
      "--- note",
      "+++i;",
    ].join("\n")
    expect(diffSummary(diff)).toEqual({ hunks: 2, added: 2, removed: 2 })
  })

  test("pure-add diff (new file)", () => {
    const diff = ["--- /dev/null", "+++ b/new.ts", "@@ -0,0 +1,3 @@", "+line a", "+line b", "+line c"].join("\n")
    expect(diffSummary(diff)).toEqual({ hunks: 1, added: 3, removed: 0 })
  })
})
