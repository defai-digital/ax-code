import { describe, expect, test } from "vitest"

import {
  MAX_VIEW_CHARS,
  detectFileLineEnding,
  normalizeEditorLineEndings,
  serializeEditorContent,
} from "./filesViewEditorContent"

describe("filesViewEditorContent", () => {
  describe("detectFileLineEnding", () => {
    test("returns LF when the content has no newlines", () => {
      expect(detectFileLineEnding("")).toBe("\n")
      expect(detectFileLineEnding("single line")).toBe("\n")
    })

    test("returns LF when LF endings dominate", () => {
      expect(detectFileLineEnding("a\nb\nc\n")).toBe("\n")
    })

    test("returns CRLF when CRLF endings dominate", () => {
      expect(detectFileLineEnding("a\r\nb\r\nc\n")).toBe("\r\n")
    })

    test("returns LF on an exact tie", () => {
      expect(detectFileLineEnding("a\r\nb\n")).toBe("\n")
    })

    test("ignores lone carriage returns", () => {
      expect(detectFileLineEnding("a\rb\rc")).toBe("\n")
    })
  })

  describe("normalizeEditorLineEndings", () => {
    test("converts CRLF and lone CR to LF", () => {
      expect(normalizeEditorLineEndings("a\r\nb\rc\nd")).toBe("a\nb\nc\nd")
    })

    test("leaves LF-only content unchanged", () => {
      expect(normalizeEditorLineEndings("a\nb\n")).toBe("a\nb\n")
    })
  })

  describe("serializeEditorContent", () => {
    test("normalizes everything to LF for LF files", () => {
      expect(serializeEditorContent("a\r\nb\rc", "\n")).toBe("a\nb\nc")
    })

    test("normalizes then converts to CRLF for CRLF files", () => {
      expect(serializeEditorContent("a\r\nb\nc", "\r\n")).toBe("a\r\nb\r\nc")
    })

    test("does not double-convert existing CRLF sequences", () => {
      expect(serializeEditorContent("a\r\nb\r\n", "\r\n")).toBe("a\r\nb\r\n")
    })
  })

  test("MAX_VIEW_CHARS caps the viewer at 200k characters", () => {
    expect(MAX_VIEW_CHARS).toBe(200_000)
  })
})
