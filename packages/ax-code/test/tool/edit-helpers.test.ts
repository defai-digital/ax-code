import { describe, expect, test } from "vitest"
import {
  convertToLineEnding,
  detectLineEnding,
  normalizeLineEndings,
  spliceNormalizedReplacement,
} from "../../src/tool/edit-helpers"

describe("tool.edit helpers", () => {
  test("normalizes CRLF to LF", () => {
    expect(normalizeLineEndings("a\r\nb\nc\r\n")).toBe("a\nb\nc\n")
  })

  test("detects the file-level line ending preference", () => {
    expect(detectLineEnding("a\nb\n")).toBe("\n")
    expect(detectLineEnding("a\r\nb\n")).toBe("\r\n")
  })

  test("converts normalized text to the requested line ending", () => {
    expect(convertToLineEnding("a\nb\n", "\n")).toBe("a\nb\n")
    expect(convertToLineEnding("a\nb\n", "\r\n")).toBe("a\r\nb\r\n")
  })

  test("splices normalized replacement while preserving untouched mixed endings", () => {
    const original = "one\r\ntwo\nthree\r\n"
    const normalizedResult = "one\ntwo updated\nthree\n"

    expect(
      spliceNormalizedReplacement({
        original,
        normalizedResult,
        replacementEnding: "\n",
      }),
    ).toBe("one\r\ntwo updated\nthree\r\n")
  })

  test("uses the requested ending for inserted replacement content", () => {
    const original = "start\r\nold\r\nend\r\n"
    const normalizedResult = "start\nnew\nline\nend\n"

    expect(
      spliceNormalizedReplacement({
        original,
        normalizedResult,
        replacementEnding: "\r\n",
      }),
    ).toBe("start\r\nnew\r\nline\r\nend\r\n")
  })
})
