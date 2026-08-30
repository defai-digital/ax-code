import { describe, expect, test } from "vitest"

import { parseDiffToUnified } from "./toolRenderers"

describe("parseDiffToUnified", () => {
  test("keeps a concatenated multi-file unified diff split into separate hunks", () => {
    const diff = [
      "--- a/file1.ts",
      "+++ b/file1.ts",
      "@@ -1,2 +1,2 @@",
      " context",
      "-old1",
      "+new1",
      "--- a/file2.ts",
      "+++ b/file2.ts",
      "@@ -1,2 +1,2 @@",
      " context2",
      "-old2",
      "+new2",
    ].join("\n")

    const hunks = parseDiffToUnified(diff)

    expect(hunks).toHaveLength(2)
    expect(hunks[0].lines.map((line) => line.content)).toEqual(["context", "old1", "new1"])
    expect(hunks[1].lines.map((line) => line.content)).toEqual(["context2", "old2", "new2"])
  })

  test("still treats a removed line that literally starts with --- as content when not paired with a +++ line", () => {
    const diff = ["@@ -1,1 +1,1 @@", "--- literal dashes", "+new"].join("\n")

    const hunks = parseDiffToUnified(diff)

    expect(hunks).toHaveLength(1)
    expect(hunks[0].lines.map((line) => ({ type: line.type, content: line.content }))).toEqual([
      { type: "removed", content: "-- literal dashes" },
      { type: "added", content: "new" },
    ])
  })
})
