import { describe, expect, test } from "vitest"
import { Token } from "../../src/util/token"

describe("Token.estimate", () => {
  test("counts CJK-adjacent blocks at the CJK rate", () => {
    expect(Token.estimate("中文字符")).toBe(4)
    // Bopomofo, enclosed CJK, CJK compatibility, Kanbun, CJK strokes
    for (const text of ["ㄅㄆㄇㄈ", "㈱㈲㈹㉀", "㍿㏄㌔㍉", "㆐㆑㆒㆓", "㇀㇁㇂㇃"]) {
      expect(Token.estimate(text)).toBe(4)
    }
  })

  test("keeps the Latin rate for ASCII text", () => {
    expect(Token.estimate("abcdefgh")).toBe(2)
  })
})
