import { expect, test, vi } from "vitest"
import { getCharacterPositions, measureText, renderFontToFrameBuffer } from "../src/lib/ascii.font.js"

test("missing glyphs keep letterspacing consistent between measure and positions", () => {
  const text = "A*B"
  const measured = measureText({ text, font: "tiny" })
  const positions = getCharacterPositions(text, "tiny")

  expect(positions.at(-1)).toBe(measured.width)
})

test("rendered width matches measured width when a glyph is missing", () => {
  const buffer = { width: 100, height: 10, setCellWithAlphaBlending: vi.fn() }
  const rendered = renderFontToFrameBuffer(buffer as never, { text: "A*B", font: "tiny" })

  expect(rendered.width).toBe(measureText({ text: "A*B", font: "tiny" }).width)
})
