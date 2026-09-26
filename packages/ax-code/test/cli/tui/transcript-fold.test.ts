import { describe, expect, test } from "vitest"
import { TRANSCRIPT_FOLD_LINE_LIMIT, transcriptFoldView } from "../../../src/cli/tui/routes/session/view-model"

function longLines(count: number) {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`)
}

describe("tui transcript fold policy", () => {
  test("a reply the user watched stream keeps every line when it finalizes", () => {
    const lines = longLines(TRANSCRIPT_FOLD_LINE_LIMIT + 120)
    const streaming = transcriptFoldView({ lines, finalAtMount: false, userFold: undefined })
    // Same input, same policy: finalizing must not change the rendered text.
    const finalized = transcriptFoldView({ lines, finalAtMount: false, userFold: undefined })

    expect(streaming.folded).toBe(false)
    expect(streaming.visibleText).toBe(lines.join("\n"))
    expect(finalized.visibleText).toBe(streaming.visibleText)
    expect(finalized.folded).toBe(false)
    // The toggle row is offered either way, so finalize adds no row either.
    expect(streaming.foldable).toBe(true)
  })

  test("a long reply that was already final when it mounted folds by default", () => {
    const lines = longLines(TRANSCRIPT_FOLD_LINE_LIMIT + 25)
    const view = transcriptFoldView({ lines, finalAtMount: true, userFold: undefined })

    expect(view.folded).toBe(true)
    expect(view.hiddenLines).toBe(25)
    expect(view.visibleText.split("\n")).toHaveLength(TRANSCRIPT_FOLD_LINE_LIMIT + 1)
    expect(view.visibleText.endsWith("\n...")).toBe(true)
    expect(view.visibleText).not.toContain("line 75")
  })

  test("the explicit toggle wins in both directions", () => {
    const lines = longLines(TRANSCRIPT_FOLD_LINE_LIMIT + 10)

    const expandedHistory = transcriptFoldView({ lines, finalAtMount: true, userFold: false })
    expect(expandedHistory.folded).toBe(false)
    expect(expandedHistory.visibleText).toBe(lines.join("\n"))

    const foldedLive = transcriptFoldView({ lines, finalAtMount: false, userFold: true })
    expect(foldedLive.folded).toBe(true)
    expect(foldedLive.hiddenLines).toBe(10)
  })

  test("a reply at the limit stays verbatim and offers no toggle", () => {
    const lines = longLines(TRANSCRIPT_FOLD_LINE_LIMIT)
    const view = transcriptFoldView({ lines, finalAtMount: true, userFold: undefined })

    expect(view.foldable).toBe(false)
    expect(view.folded).toBe(false)
    expect(view.hiddenLines).toBe(0)
    expect(view.visibleText).toBe(lines.join("\n"))
  })
})
