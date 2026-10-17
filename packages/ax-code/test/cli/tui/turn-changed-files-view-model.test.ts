import { describe, expect, test } from "vitest"
import {
  formatTurnChangedFiles,
  formatTurnChangedFilesRow,
  resolveTurnChangedFiles,
  turnChangedFiles,
  turnRowForAssistant,
  turnSnapshotRange,
  type TurnFileDiff,
  type TurnPart,
} from "../../../src/cli/tui/routes/session/turn-changed-files-view-model"

const parts = (snapshots: Array<{ type: string; snapshot?: string }>): TurnPart[] => snapshots

describe("turn snapshot range", () => {
  test("uses the first step-start and the last step-finish snapshot", () => {
    const range = turnSnapshotRange(
      parts([
        { type: "step-start", snapshot: "aaa" },
        { type: "tool", snapshot: "ignored" },
        { type: "step-finish", snapshot: "bbb" },
        { type: "step-start", snapshot: "ccc" },
        { type: "step-finish", snapshot: "ddd" },
      ]),
    )
    expect(range).toEqual({ from: "aaa", to: "ddd" })
  })

  test("is undefined when a boundary snapshot is missing", () => {
    expect(turnSnapshotRange(parts([{ type: "step-start" }, { type: "step-finish", snapshot: "bbb" }]))).toBeUndefined()
    expect(turnSnapshotRange(parts([{ type: "step-start", snapshot: "aaa" }, { type: "step-finish" }]))).toBeUndefined()
  })
})

describe("turn changed files", () => {
  const diffs: TurnFileDiff[] = [
    { file: "src/a.ts", additions: 10, deletions: 2, status: "modified" },
    { file: "src/b.ts", additions: 3, deletions: 0, status: "added" },
  ]

  test("counts files and sums added/removed lines", () => {
    expect(turnChangedFiles(diffs)).toEqual({
      count: 2,
      additions: 13,
      deletions: 2,
      files: ["src/a.ts", "src/b.ts"],
    })
  })

  test("is undefined for no diffs so no row renders", () => {
    expect(turnChangedFiles([])).toBeUndefined()
  })

  test("de-duplicates repeated file entries and clamps negative counts", () => {
    const row = turnChangedFiles([
      { file: "src/a.ts", additions: -5, deletions: -1 },
      { file: "src/a.ts", additions: 4, deletions: 1 },
      { file: "", additions: 99, deletions: 99 },
    ])
    expect(row).toEqual({ count: 1, additions: 4, deletions: 1, files: ["src/a.ts"] })
  })

  test("formats a one-line summary with singular and plural counts", () => {
    expect(formatTurnChangedFiles({ count: 1, additions: 4, deletions: 1, files: ["a"] })).toBe("1 file changed, +4 -1")
    expect(formatTurnChangedFiles({ count: 3, additions: 12, deletions: 4, files: ["a", "b", "c"] })).toBe(
      "3 files changed, +12 -4",
    )
  })

  test("formats a row with names and a cap", () => {
    const row = { count: 4, additions: 8, deletions: 1, files: ["a", "b", "c", "d"] }
    expect(formatTurnChangedFilesRow(row, 2)).toBe("4 files changed, +8 -1: a, b +2 more")
    expect(formatTurnChangedFilesRow(row, 10)).toBe("4 files changed, +8 -1: a, b, c, d")
  })
})

describe("resolve turn changed files", () => {
  test("resolves diffs through the injected diffFull using the turn range", async () => {
    const seen: Array<[string, string]> = []
    const row = await resolveTurnChangedFiles(
      parts([
        { type: "step-start", snapshot: "from1" },
        { type: "step-finish", snapshot: "to1" },
      ]),
      async (from, to) => {
        seen.push([from, to])
        return [{ file: "src/a.ts", additions: 1, deletions: 1 }]
      },
    )
    expect(seen).toEqual([["from1", "to1"]])
    expect(row).toEqual({ count: 1, additions: 1, deletions: 1, files: ["src/a.ts"] })
  })

  test("never calls diffFull when the turn has no snapshot boundaries", async () => {
    let called = false
    const row = await resolveTurnChangedFiles(parts([{ type: "text" }]), async () => {
      called = true
      return []
    })
    expect(row).toBeUndefined()
    expect(called).toBe(false)
  })
})

describe("turnRowForAssistant", () => {
  const user = {
    id: "u1",
    role: "user",
    summary: {
      diffs: [
        { file: "a.ts", additions: 3, deletions: 1 },
        { file: "b.ts", additions: 2, deletions: 0 },
      ],
    },
  }
  const step1 = { id: "a1", role: "assistant", parentID: "u1", summary: false, time: { completed: 2 } }
  const step2 = { id: "a2", role: "assistant", parentID: "u1", time: { completed: 3 } }

  test("shows the row only under the last completed assistant message of the turn", () => {
    const messages = [user, step1, step2]
    expect(turnRowForAssistant(messages, "a1")).toBeUndefined()
    expect(turnRowForAssistant(messages, "a2")).toMatchObject({ count: 2, additions: 5, deletions: 1 })
  })

  test("shows nothing for an unfinished assistant message or a turn that changed nothing", () => {
    expect(turnRowForAssistant([user, { ...step2, time: {} }], "a2")).toBeUndefined()
    expect(turnRowForAssistant([{ id: "u1", role: "user", summary: { diffs: [] } }, step2], "a2")).toBeUndefined()
    expect(turnRowForAssistant([{ id: "u1", role: "user" }, step2], "a2")).toBeUndefined()
    expect(turnRowForAssistant([user, step2], "missing")).toBeUndefined()
  })

  test("ignores an assistant boolean summary and malformed diff payloads", () => {
    expect(turnRowForAssistant([{ id: "u1", role: "user", summary: { diffs: "oops" } }, step2], "a2")).toBeUndefined()
  })
})
