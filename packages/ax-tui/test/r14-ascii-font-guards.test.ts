import { afterEach, describe, expect, test, vi } from "vitest"
import { getCharacterPositions, measureText, renderFontToFrameBuffer } from "../src/lib/ascii.font.js"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("ascii font guards reject unknown and prototype keys", () => {
  test("unknown font names measure as zero instead of throwing", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(measureText({ text: "A", font: "missing" as never })).toEqual({ width: 0, height: 0 })
  })

  test("prototype keys are not treated as cached fonts", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(measureText({ text: "A", font: "toString" as never })).toEqual({ width: 0, height: 0 })
    expect(getCharacterPositions("A", "constructor" as never)).toEqual([0])
    const buffer = { width: 100, height: 10, setCellWithAlphaBlending: vi.fn() }
    expect(renderFontToFrameBuffer(buffer as never, { text: "A", font: "valueOf" as never })).toEqual({
      width: 0,
      height: 0,
    })
  })

  test("valid fonts still measure", () => {
    const size = measureText({ text: "A" })
    expect(size.width).toBeGreaterThan(0)
    expect(size.height).toBeGreaterThan(0)
  })
})
