import { describe, expect, test } from "vitest"
import {
  createPromptPasteSubmitGate,
  DOUBLE_ESCAPE_CLEAR_MS,
  isUnmodifiedPromptSubmitKey,
  promptEscapeClearIntent,
  promptSubmissionView,
  sanitizePromptInput,
  windowsClipboardTextPaste,
} from "../../../src/cli/cmd/tui/component/prompt/view-model"
import type { PromptInfo } from "../../../src/cli/cmd/tui/component/prompt/prompt-info"

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

  test("uses Windows clipboard text as a direct paste fallback", () => {
    expect(
      windowsClipboardTextPaste({
        platform: "win32",
        content: { mime: "text/plain", data: "first\r\nsecond\rthird" },
      }),
    ).toBe("first\nsecond\nthird")
  })

  test("ignores empty Windows clipboard text fallback", () => {
    expect(
      windowsClipboardTextPaste({
        platform: "win32",
        content: { mime: "text/plain", data: "\r\n  \t" },
      }),
    ).toBeUndefined()
  })

  test("does not turn non-text clipboard data into pasted prompt text", () => {
    expect(
      windowsClipboardTextPaste({
        platform: "win32",
        content: { mime: "image/png", data: "base64" },
      }),
    ).toBeUndefined()
  })

  test("leaves non-Windows text paste to the terminal paste event", () => {
    expect(
      windowsClipboardTextPaste({
        platform: "darwin",
        content: { mime: "text/plain", data: "hello" },
      }),
    ).toBeUndefined()
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
