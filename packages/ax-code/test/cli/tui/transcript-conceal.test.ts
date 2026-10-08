import { describe, expect, test } from "vitest"
import { finishedDropsFenceRows, stripFenceLines } from "../../../src/cli/tui/routes/session/view-model"

// The streamed plain text and the finished render must agree on fence rows at
// the finalize swap: the markdown renderable consumes fences structurally,
// the code renderable hides them while conceal is on, and plain text plus
// unconcealed code paint the raw source.
describe("finishedDropsFenceRows", () => {
  test("markdown mode always drops fence rows", () => {
    expect(finishedDropsFenceRows("markdown", true)).toBe(true)
    expect(finishedDropsFenceRows("markdown", false)).toBe(true)
  })

  test("code mode drops fence rows only while conceal is on", () => {
    expect(finishedDropsFenceRows("code", true)).toBe(true)
    expect(finishedDropsFenceRows("code", false)).toBe(false)
  })

  test("plain mode never drops fence rows", () => {
    expect(finishedDropsFenceRows("plain", true)).toBe(false)
    expect(finishedDropsFenceRows("plain", false)).toBe(false)
  })

  test("code mode with conceal on keeps the streamed and finished row counts equal", () => {
    const source = ["intro", "", "```ts", "const answer = 42", "```", "", "outro"].join("\n")
    const trimmed = (conceal: boolean) =>
      (finishedDropsFenceRows("code", conceal) ? stripFenceLines(source) : source).trim()
    // Conceal on: the finished code render hides fence rows, so the source
    // drops them and the finalize swap changes no row.
    expect(trimmed(true)).toBe(["intro", "", "const answer = 42", "", "outro"].join("\n"))
    // Conceal off: the finished code render paints the fences raw, matching
    // the streamed plain text exactly.
    expect(trimmed(false)).toBe(source)
  })
})
