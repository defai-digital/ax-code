import { describe, expect, test } from "vitest"
import type { Snapshot } from "../../src/snapshot"
import { SessionSemanticCore } from "../../src/session/semantic-core"

function fileDiff(input: Partial<Snapshot.FileDiff> & Pick<Snapshot.FileDiff, "file">): Snapshot.FileDiff {
  return {
    before: "",
    after: "",
    additions: 0,
    deletions: 0,
    status: "modified",
    ...input,
  }
}

describe("SessionSemanticCore", () => {
  test("deduplicates per-change semantic signals while preserving order", () => {
    const change = SessionSemanticCore.change(
      fileDiff({
        file: "src/server/auth.ts",
        after: "if (!token) throw new Error('missing token')\n",
        additions: 40,
        deletions: 0,
      }),
    )

    expect(change.signals).toEqual(["40 lines touched", "guard or validation logic added", "runtime path affected"])
  })

  test("deduplicates summary signals before applying the four-item cap", () => {
    const summary = SessionSemanticCore.summarize([
      fileDiff({
        file: "src/server/auth.ts",
        after: "if (!token) throw new Error('missing token')\n",
        additions: 4,
      }),
      fileDiff({
        file: "src/routes/session.ts",
        after: "if (!session) throw new Error('missing session')\n",
        additions: 4,
      }),
      fileDiff({
        file: "src/worker.ts",
        after: "const cache = new Map()\n",
        additions: 2,
      }),
    ])

    expect(summary?.signals).toEqual([
      "4 lines touched",
      "guard or validation logic added",
      "runtime path affected",
      "2 lines touched",
    ])
  })
})
