import { describe, expect, test } from "bun:test"
import { computeIncrementalChanges, MAX_INCREMENTAL_HUNKS } from "../../src/lsp/client"

describe("computeIncrementalChanges", () => {
  test("returns null and empty list for identical inputs", () => {
    // Identical input, identical output — no changes produced. The caller
    // already handles the "unchanged" case via the hash-skip path, so this
    // branch is mostly defensive.
    const result = computeIncrementalChanges("a\nb\nc\n", "a\nb\nc\n")
    // Either null or empty array is acceptable; caller treats both as
    // "nothing to send incrementally".
    if (result !== null) expect(result.length).toBe(0)
  })

  test("replaces a single line in the middle", () => {
    const oldText = "line1\nline2\nline3\n"
    const newText = "line1\nLINE2\nline3\n"
    const result = computeIncrementalChanges(oldText, newText)
    expect(result).not.toBeNull()
    expect(result!.length).toBe(1)
    const hunk = result![0]
    expect(hunk.range.start.line).toBe(1)
    expect(hunk.range.start.character).toBe(0)
    expect(hunk.range.end.line).toBe(2)
    expect(hunk.range.end.character).toBe(0)
    expect(hunk.text).toBe("LINE2\n")
  })

  test("inserts a line at the top", () => {
    const oldText = "a\nb\n"
    const newText = "new\na\nb\n"
    const result = computeIncrementalChanges(oldText, newText)
    expect(result).not.toBeNull()
    expect(result!.length).toBe(1)
    expect(result![0].range.start.line).toBe(0)
    expect(result![0].range.end.line).toBe(0)
    expect(result![0].text).toBe("new\n")
  })

  test("deletes lines from the middle", () => {
    const oldText = "a\nb\nc\nd\ne\n"
    const newText = "a\ne\n"
    const result = computeIncrementalChanges(oldText, newText)
    expect(result).not.toBeNull()
    expect(result!.length).toBe(1)
    // Remove lines 1..3 (b, c, d), keep a and e
    expect(result![0].range.start.line).toBe(1)
    expect(result![0].range.end.line).toBe(4)
    expect(result![0].text).toBe("")
  })

  test("emits multiple hunks for non-contiguous edits", () => {
    const oldText = "a\nb\nc\nd\ne\n"
    const newText = "A\nb\nc\nD\ne\n"
    const result = computeIncrementalChanges(oldText, newText)
    expect(result).not.toBeNull()
    expect(result!.length).toBeGreaterThanOrEqual(2)
  })

  test("returns null for pathological diffs with too many hunks", () => {
    // Interleave changes to produce more than MAX_INCREMENTAL_HUNKS hunks.
    const lines: string[] = []
    for (let i = 0; i < MAX_INCREMENTAL_HUNKS * 3; i++) {
      lines.push(`line-${i}`)
    }
    const oldText = lines.join("\n") + "\n"
    // Alter every second line to force alternating change/unchanged segments.
    const newLines = lines.map((l, i) => (i % 2 === 0 ? `altered-${i}` : l))
    const newText = newLines.join("\n") + "\n"
    const result = computeIncrementalChanges(oldText, newText)
    expect(result).toBeNull()
  })

  test("returns null when inputs exceed the size budget", () => {
    const big = "x".repeat(2_000_000) // 2 MB, above MAX_INCREMENTAL_SYNC_BYTES
    const result = computeIncrementalChanges(big, big + "y")
    expect(result).toBeNull()
  })

  test("range end is exclusive at the start of the next line", () => {
    // Replacing the last line of a file: the end position must be at the
    // start of line N+1, not at the end of line N. This is the LSP
    // convention for "the end of the file" — a character 0 on a line
    // beyond the last line.
    const oldText = "a\nb\nlast\n"
    const newText = "a\nb\nreplaced\n"
    const result = computeIncrementalChanges(oldText, newText)
    expect(result).not.toBeNull()
    expect(result!.length).toBe(1)
    expect(result![0].range.start.line).toBe(2)
    expect(result![0].range.end.line).toBe(3)
    expect(result![0].text).toBe("replaced\n")
  })

  test("handles pure appends", () => {
    const oldText = "a\nb\n"
    const newText = "a\nb\nc\nd\n"
    const result = computeIncrementalChanges(oldText, newText)
    expect(result).not.toBeNull()
    expect(result!.length).toBe(1)
    // Inserted at end: range is start=end=line 2 (past last line in old)
    expect(result![0].range.start.line).toBe(2)
    expect(result![0].range.end.line).toBe(2)
    expect(result![0].text).toBe("c\nd\n")
  })
})
