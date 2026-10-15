import { describe, expect, test } from "vitest"
import {
  finishedConcealsFenceRows,
  isFenceLine,
  stripFenceLines,
  streamingTextRenderMode,
  transcriptFoldView,
  TRANSCRIPT_FOLD_LINE_LIMIT,
} from "../../../src/cli/tui/routes/session/view-model"

// The streamed plain text and the finished render must agree on fence rows at
// the finalize swap: the markdown renderable consumes fences structurally,
// the code renderable removes them (`conceal_lines`) while conceal is on, and
// plain text plus unconcealed code paint the raw source.
describe("finishedConcealsFenceRows", () => {
  test("markdown mode always hides fence rows", () => {
    expect(finishedConcealsFenceRows("markdown", true)).toBe(true)
    expect(finishedConcealsFenceRows("markdown", false)).toBe(true)
  })

  test("code mode hides fence rows only while conceal is on", () => {
    expect(finishedConcealsFenceRows("code", true)).toBe(true)
    expect(finishedConcealsFenceRows("code", false)).toBe(false)
  })

  test("plain mode never hides fence rows", () => {
    expect(finishedConcealsFenceRows("plain", true)).toBe(false)
    expect(finishedConcealsFenceRows("plain", false)).toBe(false)
  })

  test("is asked about the finished mode, so the streamed text drops fences", () => {
    // Regression: the transcript used to pass the *current* mode, which is
    // "plain" while streaming, so the streamed text kept its fences and the
    // finished text lost them (no highlighting, two rows gone at finalize).
    const finished = streamingTextRenderMode({ final: true, experimentalMarkdown: false })
    expect(finishedConcealsFenceRows(finished, true)).toBe(true)
  })

  test("only the streamed text is stripped; the finished text keeps its fences", () => {
    const source = ["intro", "", "```ts", "const answer = 42", "```", "", "outro"].join("\n")
    const text = (mode: "plain" | "code", conceal: boolean) =>
      (mode === "plain" && finishedConcealsFenceRows("code", conceal) ? stripFenceLines(source) : source).trim()
    // Conceal on: the streamed text drops the fence rows the finished code
    // render conceals, and the finished render keeps them to highlight the code.
    expect(text("plain", true)).toBe(["intro", "", "const answer = 42", "", "outro"].join("\n"))
    expect(text("code", true)).toBe(source)
    // Conceal off: both paint the fences raw.
    expect(text("plain", false)).toBe(source)
    expect(text("code", false)).toBe(source)
  })
})

describe("isFenceLine", () => {
  test("matches complete delimiters only", () => {
    expect(isFenceLine("```ts")).toBe(true)
    expect(isFenceLine("```")).toBe(true)
    expect(isFenceLine("~~~")).toBe(true)
    expect(isFenceLine("``")).toBe(false)
    expect(isFenceLine("    ```ts")).toBe(false)
    expect(isFenceLine("text ``` inline")).toBe(false)
  })
})

describe("transcriptFoldView with concealed fence rows", () => {
  const body = Array.from({ length: TRANSCRIPT_FOLD_LINE_LIMIT }, (_, index) => `line ${index}`)
  const source = ["```ts", ...body, "```"]

  test("fence rows do not count toward the fold limit", () => {
    // 52 source lines, 50 painted rows: the streamed (stripped) text is not
    // foldable, so the finished one must not grow a toggle row either.
    const streamed = transcriptFoldView({
      lines: stripFenceLines(source.join("\n")).split("\n"),
      finalAtMount: true,
      userFold: undefined,
    })
    const finished = transcriptFoldView({
      lines: source,
      finalAtMount: true,
      userFold: undefined,
      hiddenRow: isFenceLine,
    })
    expect(streamed.foldable).toBe(false)
    expect(finished.foldable).toBe(false)
    expect(finished.visibleText).toBe(source.join("\n"))
  })

  test("a folded head keeps the limit of painted rows plus the fences among them", () => {
    const lines = ["```ts", ...body, "```", "tail"]
    const view = transcriptFoldView({ lines, finalAtMount: true, userFold: undefined, hiddenRow: isFenceLine })
    expect(view.folded).toBe(true)
    expect(view.hiddenLines).toBe(1)
    expect(view.visibleText).toBe(["```ts", ...body].join("\n") + "\n...")
  })
})
