import { describe, expect, test } from "vitest"
import { charWidth, stringWidth } from "../../../src/bun/node-compat"
import { displayOffsetFromStringIndex, endDisplayOffset } from "../../../src/cli/tui/component/prompt/prompt-helpers"

// prompt-helpers measures one scalar at a time through charWidth. This pins
// that shortcut to the whole-string stringWidth it replaced.
const viaStringWidth = (char: string) => (char === "\n" ? 1 : stringWidth(char))
const viaCharWidth = (char: string) => (char === "\n" ? 1 : charWidth(char.codePointAt(0) ?? 0))

describe("prompt display width per scalar", () => {
  test("matches stringWidth for every BMP code point and notable astral ones", () => {
    for (let cp = 0; cp <= 0xffff; cp++) {
      const char = String.fromCodePoint(cp)
      expect(viaCharWidth(char), cp.toString(16)).toBe(viaStringWidth(char))
    }
    for (const cp of [0x1f600, 0x1f468, 0x20000, 0x3fffd, 0xe0001, 0x10ffff]) {
      const char = String.fromCodePoint(cp)
      expect(viaCharWidth(char), cp.toString(16)).toBe(viaStringWidth(char))
    }
    expect(viaCharWidth("\ud800")).toBe(viaStringWidth("\ud800"))
  })

  test("helper offsets match an oracle built on stringWidth", () => {
    const text = "a\u{1f600}中\ńe\x1b\u009b\nz \t\x7f"
    const oracle = (input: string, stringIndex: number) => {
      let width = 0
      let index = 0
      for (const char of input) {
        if (index >= stringIndex) break
        width += viaStringWidth(char)
        index += char.length
      }
      return width
    }
    for (let index = 0; index <= text.length; index++) {
      expect(displayOffsetFromStringIndex(text, index)).toBe(oracle(text, index))
    }
    expect(endDisplayOffset(text)).toBe(oracle(text, text.length))
  })
})
