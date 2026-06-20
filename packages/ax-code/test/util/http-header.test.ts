import { describe, expect, test } from "vitest"
import { parseContentLengthHeader } from "../../src/util/http-header"

describe("parseContentLengthHeader", () => {
  test("accepts decimal byte counts", () => {
    expect(parseContentLengthHeader("0")).toBe(0)
    expect(parseContentLengthHeader("0012")).toBe(12)
    expect(parseContentLengthHeader(" 42 ")).toBe(42)
  })

  test("rejects non-decimal byte counts", () => {
    expect(parseContentLengthHeader("0x10")).toBeUndefined()
    expect(parseContentLengthHeader("1e6")).toBeUndefined()
    expect(parseContentLengthHeader("Infinity")).toBeUndefined()
    expect(parseContentLengthHeader("")).toBeUndefined()
  })

  test("treats unsafe decimal byte counts as oversized", () => {
    expect(parseContentLengthHeader("999999999999999999999999")).toBe(Number.MAX_SAFE_INTEGER)
  })
})
