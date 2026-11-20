import { expect, test, vi } from "vitest"
import { hsvToRgb, parseColor } from "../src/lib/rgba.js"

test("negative hues normalize into the color wheel", () => {
  expect(hsvToRgb(-60, 1, 1).toInts()).toEqual(hsvToRgb(300, 1, 1).toInts())
  expect(hsvToRgb(-60, 1, 1).toInts()).toEqual([255, 0, 255, 255])
})

test("hues past a full turn wrap to the same color", () => {
  expect(hsvToRgb(420, 1, 1).toInts()).toEqual(hsvToRgb(60, 1, 1).toInts())
  expect(hsvToRgb(360, 1, 1).toInts()).toEqual(hsvToRgb(0, 1, 1).toInts())
})

test("inherited object keys fall back to magenta instead of crashing", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  try {
    for (const name of ["constructor", "__proto__", "CONSTRUCTOR"]) {
      expect(parseColor(name).toInts()).toEqual([255, 0, 255, 255])
    }
    expect(parseColor("red").toInts()).toEqual([255, 0, 0, 255])
    expect(parseColor("transparent").toInts()).toEqual([0, 0, 0, 0])
  } finally {
    warn.mockRestore()
  }
})
