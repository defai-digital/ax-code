import { describe, expect, test } from "vitest"
import { computeDiffLines } from "../../../src/cli/cmd/tui/component/dialog-diff-viewer"

// Reference: the previous unbounded O(m*n) LCS with a full number[][] matrix.
// The hardened computeDiffLines must produce byte-identical output to this for
// small/normal diffs, while never allocating a full matrix for large inputs.
function referenceDiff(before: string, after: string): Array<{ type: "add" | "remove" | "context"; text: string }> {
  const beforeLines = before ? before.split("\n") : []
  const afterLines = after ? after.split("\n") : []
  const m = beforeLines.length
  const n = afterLines.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = beforeLines[i - 1] === afterLines[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
  const ops: Array<"=" | "+" | "-"> = []
  let i = m
  let j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && beforeLines[i - 1] === afterLines[j - 1]) {
      ops.push("=")
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push("+")
      j--
    } else {
      ops.push("-")
      i--
    }
  }
  ops.reverse()
  const result: Array<{ type: "add" | "remove" | "context"; text: string }> = []
  let bi = 0
  let ai = 0
  for (const op of ops) {
    if (op === "=") {
      result.push({ type: "context", text: "  " + beforeLines[bi] })
      bi++
      ai++
    } else if (op === "-") {
      result.push({ type: "remove", text: "- " + beforeLines[bi] })
      bi++
    } else {
      result.push({ type: "add", text: "+ " + afterLines[ai] })
      ai++
    }
  }
  return result
}

describe("computeDiffLines (diff viewer LCS hardening)", () => {
  const smallCases: Array<[string, string]> = [
    ["", ""],
    ["", "x"],
    ["x", ""],
    ["a\nb\nc", "a\nb\nc"],
    ["a\nb\nc", "a\nB\nc"],
    ["a\nb", "a\nb\nc"],
    ["x\ny\nz", "y\nz"],
    ["a\nb\nc\nd\ne", "a\nc\nd\nX\ne"],
    ["line1\nline2\nline3\nline4", "line1\nline2-mod\nline3\nline4\nline5"],
    ["one\ntwo\nthree", "zero\none\ntwo\nthree"],
  ]

  test("produces identical output to the old full-matrix LCS on small diffs", () => {
    for (const [before, after] of smallCases) {
      expect(computeDiffLines(before, after)).toEqual(referenceDiff(before, after))
    }
  })

  test("prefix/suffix-only common lines are emitted as context", () => {
    const before = "keep1\nkeep2\nold\nkeep3"
    const after = "keep1\nkeep2\nnew\nkeep3"
    expect(computeDiffLines(before, after)).toEqual([
      { type: "context", text: "  keep1" },
      { type: "context", text: "  keep2" },
      { type: "remove", text: "- old" },
      { type: "add", text: "+ new" },
      { type: "context", text: "  keep3" },
    ])
  })

  test("huge but mostly-identical file (lockfile case) stays fast via prefix/suffix trim", () => {
    // ~20k identical lines with a single changed line in the middle. The old
    // code allocated a (20k+1)^2 matrix (~3+GB) and OOM-crashed; trimming
    // collapses this to a one-line middle window.
    const size = 20_000
    const beforeArr = Array.from({ length: size }, (_, k) => `line-${k}`)
    const afterArr = beforeArr.slice()
    afterArr[size / 2] = "line-CHANGED"
    const t0 = performance.now()
    const out = computeDiffLines(beforeArr.join("\n"), afterArr.join("\n"))
    const elapsed = performance.now() - t0
    expect(elapsed).toBeLessThan(1000)
    // Exactly one removal + one addition; everything else is context.
    expect(out.filter((l) => l.type === "remove")).toEqual([{ type: "remove", text: "- line-10000" }])
    expect(out.filter((l) => l.type === "add")).toEqual([{ type: "add", text: "+ line-CHANGED" }])
    expect(out).toHaveLength(size + 1)
  })

  test("large fully-different file falls back to a degenerate diff without allocating the matrix", () => {
    // Two completely distinct large files: no common prefix/suffix, and
    // m*n (2000*2000 = 4M) exceeds the 1M cell budget, so this must take the
    // degenerate path (all removals, then all additions) rather than an O(m*n)
    // LCS. A full number[][] matrix here would be huge and slow.
    const size = 2_000
    const before = Array.from({ length: size }, (_, k) => `before-${k}`).join("\n")
    const after = Array.from({ length: size }, (_, k) => `after-${k}`).join("\n")
    const t0 = performance.now()
    const out = computeDiffLines(before, after)
    const elapsed = performance.now() - t0
    expect(elapsed).toBeLessThan(1000)
    expect(out).toHaveLength(size * 2)
    // Degenerate ordering: all removals first, then all additions.
    for (let k = 0; k < size; k++) expect(out[k]).toEqual({ type: "remove", text: `- before-${k}` })
    for (let k = 0; k < size; k++) expect(out[size + k]).toEqual({ type: "add", text: `+ after-${k}` })
  })
})
