import { describe, expect, test } from "vitest"
import * as fs from "node:fs/promises"
import path from "node:path"
import {
  FOOTER_ANIMATION_FRAMES,
  FOOTER_ANIMATION_INTERVAL_MS,
  footerStaticFrame,
} from "../../../src/cli/tui/component/footer-animation"

// A braille cell (U+2800-U+28FF) is East Asian Width "Narrow" and CJK-safe;
// ambiguous-width block glyphs drift CJK layouts and must not come back.
const isBrailleCell = (char: string) => {
  const code = char.codePointAt(0) ?? 0
  return code >= 0x2800 && code <= 0x28ff
}

describe("footer A/X pixel morph", () => {
  test("morphs the A/X brand mark in two braille cells per frame", () => {
    expect(FOOTER_ANIMATION_FRAMES).toHaveLength(26)
    for (const frame of FOOTER_ANIMATION_FRAMES) {
      expect([...frame]).toHaveLength(2)
      for (const char of frame) expect(isBrailleCell(char)).toBe(true)
    }
    // Each held pose shows a full brand letter.
    for (const glyph of ["\u286e\u28b5", "\u2871\u288e"]) {
      expect(FOOTER_ANIMATION_FRAMES).toContain(glyph)
    }
    expect(FOOTER_ANIMATION_INTERVAL_MS).toBe(70)
  })

  test("holds each glyph and flips at most one dot per frame", () => {
    const frames = FOOTER_ANIMATION_FRAMES
    for (let i = 0; i < frames.length; i++) {
      const current = frames[i] ?? ""
      const next = frames[(i + 1) % frames.length] ?? ""
      const changed = [0, 1].filter((cell) => current.charCodeAt(cell) !== next.charCodeAt(cell))
      expect(changed.length).toBeLessThanOrEqual(1)
      if (changed.length === 1) {
        const xor = current.charCodeAt(changed[0] ?? 0) ^ next.charCodeAt(changed[0] ?? 0)
        // One braille dot == exactly one bit in the cell's 8-dot mask.
        expect(xor).toBeGreaterThan(0)
        expect(xor & (xor - 1)).toBe(0)
      }
    }
  })

  test("static fallback holds the full A pose when animations are disabled", () => {
    expect(footerStaticFrame()).toBe(FOOTER_ANIMATION_FRAMES[0])
    // The full "A" pose, not a mid-morph frame.
    expect(footerStaticFrame()).toBe("\u286e\u28b5")
    // Degenerate frame lists must not crash the disabled path.
    expect(footerStaticFrame([])).toBe("")
  })

  test("footer morph honors the animations_enabled kv setting", async () => {
    const source = await fs.readFile(
      path.resolve(import.meta.dirname, "../../../src/cli/tui/component/footer-animation.tsx"),
      "utf8",
    )
    // The busy glyph follows the user's setting; the static frame above is
    // what renders when it is off. Compiled builds keep it animated because it
    // is their only busy indicator, so the runtime-mode policy is not applied.
    expect(source).toContain('kv.get("animations_enabled", true)')
    expect(source).not.toContain("shouldUseTuiAnimations")
  })
})
