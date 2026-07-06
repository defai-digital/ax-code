import { describe, expect, test } from "vitest"
import {
  createPromptPasteSubmitGate,
  DOUBLE_ESCAPE_CLEAR_MS,
  isUnmodifiedPromptSubmitKey,
  promptEscapeClearIntent,
  sanitizePromptInput,
  windowsClipboardTextPaste,
} from "../../../src/cli/cmd/tui/component/prompt/view-model"

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

  test("strips SGR mouse residue from prompt input", () => {
    expect(sanitizePromptInput("hello <0;12;34Mworld 35;46;57m")).toBe("hello world ")
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
