import { describe, expect, test } from "vitest"
import {
  createPromptPasteSubmitGate,
  DOUBLE_ESCAPE_CLEAR_MS,
  hasPromptDraft,
  isUnmodifiedPromptSubmitKey,
  promptEscapeClearIntent,
  promptSubmissionView,
  sanitizePromptInput,
  clipboardTextPaste,
} from "../../../src/cli/tui/component/prompt/view-model"
import type { PromptInfo } from "../../../src/cli/tui/component/prompt/prompt-info"

function pastedTextPart(text: string, placeholder: string, start: number, end: number): PromptInfo["parts"][number] {
  return {
    type: "text",
    text,
    source: {
      text: {
        value: placeholder,
        start,
        end,
      },
    },
  }
}

describe("prompt view model", () => {
  test("hasPromptDraft treats a parts-only prompt as a draft (regression: ctrl+c exited instead of clearing)", () => {
    expect(hasPromptDraft("", [])).toBe(false)
    expect(hasPromptDraft("hello", [])).toBe(true)
    // An image-only (or @agent-reference-only) draft has empty text but non-empty
    // parts — ctrl+c must clear it, not exit the app.
    expect(hasPromptDraft("", [{ type: "file" }])).toBe(true)
    expect(hasPromptDraft("hello", [{ type: "file" }])).toBe(true)
  })

  test("arms clear on the first escape when the prompt has draft text", () => {
    expect(
      promptEscapeClearIntent({
        keyName: "escape",
        hasDraft: true,
        now: 1_000,
      }),
    ).toEqual({
      action: "arm",
      nextEscapeAt: 1_000,
    })
  })

  test("clears draft text on a second escape within the confirmation window", () => {
    expect(
      promptEscapeClearIntent({
        keyName: "escape",
        hasDraft: true,
        previousEscapeAt: 1_000,
        now: 1_000 + DOUBLE_ESCAPE_CLEAR_MS,
      }),
    ).toEqual({ action: "clear" })
  })

  test("re-arms when the second escape arrives after the confirmation window", () => {
    expect(
      promptEscapeClearIntent({
        keyName: "escape",
        hasDraft: true,
        previousEscapeAt: 1_000,
        now: 1_001 + DOUBLE_ESCAPE_CLEAR_MS,
      }),
    ).toEqual({
      action: "arm",
      nextEscapeAt: 1_001 + DOUBLE_ESCAPE_CLEAR_MS,
    })
  })

  test("lets escape follow the standard flow when the prompt is empty", () => {
    expect(
      promptEscapeClearIntent({
        keyName: "escape",
        hasDraft: false,
        previousEscapeAt: 1_000,
        now: 1_500,
      }),
    ).toEqual({ action: "passthrough" })
  })

  test("resets the armed state on non-escape keys", () => {
    expect(
      promptEscapeClearIntent({
        keyName: "a",
        hasDraft: true,
        previousEscapeAt: 1_000,
        now: 1_500,
      }),
    ).toEqual({ action: "passthrough" })
  })

  test("normalizes clipboard text line endings for direct paste", () => {
    expect(clipboardTextPaste({ content: { mime: "text/plain", data: "first\r\nsecond\rthird" } })).toBe(
      "first\nsecond\nthird",
    )
  })

  test("ignores empty clipboard text", () => {
    expect(clipboardTextPaste({ content: { mime: "text/plain", data: "\r\n  \t" } })).toBeUndefined()
  })

  test("does not turn non-text clipboard data into pasted prompt text", () => {
    expect(clipboardTextPaste({ content: { mime: "image/png", data: "base64" } })).toBeUndefined()
  })

  test("ignores a missing clipboard payload", () => {
    expect(clipboardTextPaste({ content: undefined })).toBeUndefined()
  })

  test("strips SGR mouse residue (marked with <) from prompt input", () => {
    expect(sanitizePromptInput("hello <0;12;34Mworld")).toBe("hello world")
  })

  test("preserves legitimate ANSI color codes and semicolon triples the user typed", () => {
    // Bare digit;digit;digit + M/m without the SGR "<" marker is real content, not residue.
    expect(sanitizePromptInput("color 35;46;57m and 1;31;40m stay")).toBe("color 35;46;57m and 1;31;40m stay")
  })

  test("preserves ordinary semicolon-separated prompt text", () => {
    expect(sanitizePromptInput("versions 1;2;3 and keep 4;5;6x")).toBe("versions 1;2;3 and keep 4;5;6x")
  })

  test("strips terminal reply tails typed as trailing keystrokes", () => {
    // A reply that outlives the stdin parser's assembly timeout is re-typed
    // into the prompt as bare tail bytes (no ESC[ prefix).
    expect(sanitizePromptInput("hello 4;87R")).toBe("hello ")
    expect(sanitizePromptInput("hello 4;1152;846t")).toBe("hello ")
    expect(sanitizePromptInput("hello?2026;1$y")).toBe("hello")
    expect(sanitizePromptInput("hello?7u")).toBe("hello")
    expect(sanitizePromptInput("hello?1;2c")).toBe("hello")
  })

  test("strips adjacent leaked reply tails to a fixpoint", () => {
    // Two replies leaking back to back: "?1;2c" is stripped first, which makes
    // "4;87R" the new trailing tail.
    expect(sanitizePromptInput("prompt 4;87R?1;2c")).toBe("prompt ")
  })

  test("preserves reply-shaped text the user typed or pasted mid-content", () => {
    // The patterns are end-anchored: only trailing tails are treated as leaks.
    expect(sanitizePromptInput("is 1920;1080R a resolution?")).toBe("is 1920;1080R a resolution?")
    expect(sanitizePromptInput("what does ?1;2c mean")).toBe("what does ?1;2c mean")
    expect(sanitizePromptInput("4;5;6x stays")).toBe("4;5;6x stays")
  })

  test("treats raw CRLF as prompt submit when terminals send Enter as one chunk", () => {
    expect(isUnmodifiedPromptSubmitKey({ name: "", raw: "\r\n", sequence: "\r\n" })).toBe(true)
  })

  test("treats CSI-u LF as prompt submit after terminal paste", () => {
    expect(isUnmodifiedPromptSubmitKey({ name: "\n", raw: "\u001b[10u", sequence: "\n" })).toBe(true)
  })

  test("does not submit modified raw CRLF Enter", () => {
    expect(isUnmodifiedPromptSubmitKey({ name: "", raw: "\r\n", sequence: "\r\n", shift: true })).toBe(false)
  })

  test("does not let raw CRLF override a non-submit key name", () => {
    expect(isUnmodifiedPromptSubmitKey({ name: "v", raw: "\r\n", sequence: "\r\n" })).toBe(false)
  })

  test("expands placeholders after CJK text using display offsets", () => {
    // "你好 " is 3 UTF-16 units but 5 display columns; the extmark range is
    // stored in display columns ([x] spans 5..8).
    const result = promptSubmissionView({
      text: "你好 [x] after",
      parts: [pastedTextPart("PASTED", "[x]", 5, 8)],
      extmarks: [{ id: 1, start: 5, end: 8 }],
      extmarkToPartIndex: new Map([[1, 0]]),
    })

    expect(result.text).toBe("你好 PASTED after")
    expect(result.parts).toEqual([])
  })

  test("expands placeholders after emoji and CJK mixes", () => {
    // "🙂你好 " = 4 code points / 5 UTF-16 units, 7 display columns.
    const result = promptSubmissionView({
      text: "🙂你好 [x] end",
      parts: [pastedTextPart("PASTED", "[x]", 7, 10)],
      extmarks: [{ id: 1, start: 7, end: 10 }],
      extmarkToPartIndex: new Map([[1, 0]]),
    })

    expect(result.text).toBe("🙂你好 PASTED end")
  })

  test("expands placeholders on later lines counting newlines as one column", () => {
    // "line1\n" = 6 buffer units (newline counts as 1 like the edit buffer).
    const result = promptSubmissionView({
      text: "line1\n[x] end",
      parts: [pastedTextPart("PASTED", "[x]", 6, 9)],
      extmarks: [{ id: 1, start: 6, end: 9 }],
      extmarkToPartIndex: new Map([[1, 0]]),
    })

    expect(result.text).toBe("line1\nPASTED end")
  })

  test("keeps non-text parts and skips unmapped extmarks on submit", () => {
    const filePart: PromptInfo["parts"][number] = {
      type: "file",
      mime: "text/plain",
      url: "file:///tmp/a.txt",
      filename: "a.txt",
      source: {
        type: "file",
        path: "/tmp/a.txt",
        text: { value: "@a.txt", start: 0, end: 6 },
      },
    }

    const result = promptSubmissionView({
      text: "@a.txt hi",
      parts: [filePart],
      extmarks: [{ id: 1, start: 0, end: 6 }],
      extmarkToPartIndex: new Map([[1, 0]]),
    })

    expect(result.text).toBe("@a.txt hi")
    expect(result.parts).toEqual([filePart])
  })

  test("defers Enter submission until paste handling finishes", () => {
    let submits = 0
    const gate = createPromptPasteSubmitGate({ submit: () => submits++ })

    gate.beginPasteHandling()
    expect(gate.deferSubmitUntilPasteHandled()).toBe(true)
    expect(submits).toBe(0)

    gate.finishPasteHandling()
    expect(submits).toBe(1)
  })

  test("waits for all in-flight paste handlers before deferred submit", () => {
    let submits = 0
    const gate = createPromptPasteSubmitGate({ submit: () => submits++ })

    gate.beginPasteHandling()
    gate.beginPasteHandling()
    expect(gate.deferSubmitUntilPasteHandled()).toBe(true)

    gate.finishPasteHandling()
    expect(submits).toBe(0)

    gate.finishPasteHandling()
    expect(submits).toBe(1)
    expect(gate.deferSubmitUntilPasteHandled()).toBe(false)
  })

  test("cancels deferred submit when paste fallback does not handle content", () => {
    let submits = 0
    const gate = createPromptPasteSubmitGate({ submit: () => submits++ })

    gate.beginPasteHandling()
    expect(gate.deferSubmitUntilPasteHandled()).toBe(true)
    gate.finishPasteHandling({ submitDeferred: false })

    expect(submits).toBe(0)
    expect(gate.deferSubmitUntilPasteHandled()).toBe(false)
  })
})
