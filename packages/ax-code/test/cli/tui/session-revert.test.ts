import { describe, expect, test } from "bun:test"
import { diffFiles, revertedMessages, revertState } from "../../src/cli/cmd/tui/routes/session/revert"

describe("tui session revert helpers", () => {
  test("parses diff file stats", () => {
    expect(
      diffFiles(`diff --git a/src/a.ts b/src/a.ts
index 1..2 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1,2 @@
-old
+new
+more
`),
    ).toEqual([
      {
        filename: "src/a.ts",
        additions: 2,
        deletions: 1,
      },
    ])
  })

  test("ignores invalid diffs", () => {
    expect(diffFiles("not a patch")).toEqual([])
  })

  test("selects reverted user messages from the marker", () => {
    expect(
      revertedMessages(
        [
          { id: "a", role: "user" },
          { id: "b", role: "assistant" },
          { id: "c", role: "user" },
        ],
        "b",
      ),
    ).toEqual([{ id: "c", role: "user" }])
  })

  test("builds revert state when a marker exists", () => {
    expect(
      revertState(
        {
          messageID: "b",
          diff: `diff --git a/file.txt b/file.txt
index 1..2 100644
--- a/file.txt
+++ b/file.txt
@@ -1 +1 @@
-a
+b
`,
        },
        [
          { id: "a", role: "assistant" },
          { id: "b", role: "assistant" },
          { id: "c", role: "user" },
        ],
      ),
    ).toEqual({
      messageID: "b",
      reverted: [{ id: "c", role: "user" }],
      diff: `diff --git a/file.txt b/file.txt
index 1..2 100644
--- a/file.txt
+++ b/file.txt
@@ -1 +1 @@
-a
+b
`,
      diffFiles: [
        {
          filename: "file.txt",
          additions: 1,
          deletions: 1,
        },
      ],
    })
  })

  test("returns undefined when no revert marker exists", () => {
    expect(revertState({}, [{ id: "a", role: "user" }])).toBeUndefined()
  })
})
