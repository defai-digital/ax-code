import { expect, test } from "vitest"
import { renderReefPixels } from "../../../src/cli/tui/component/reef-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

const lum = (frame: Buffer, x: number, y: number) => {
  const [r, g, b] = pixel(frame, x, y)
  return 0.299 * r! + 0.587 * g! + 0.114 * b!
}

test.each(["reef-day", "reef-night"] as const)("%s paints deterministically from elapsed time", (style) => {
  const first = renderReefPixels(WIDTH, HEIGHT, style, 0)
  const moving = renderReefPixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(moving.equals(renderReefPixels(WIDTH, HEIGHT, style, 900))).toBe(true)
  expect(first.equals(moving)).toBe(false)
  expect(renderReefPixels(WIDTH, HEIGHT, style, 2400).equals(first)).toBe(true)
  expect(renderReefPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
})

test("day water is bright and the sand is lit; night is dark and glows", () => {
  const day = renderReefPixels(WIDTH, HEIGHT, "reef-day", 0)
  const night = renderReefPixels(WIDTH, HEIGHT, "reef-night", 0)
  expect(lum(day, 380, 150)).toBeGreaterThan(lum(night, 380, 150) + 40)
  expect(lum(day, 385, 470)).toBeGreaterThan(lum(night, 385, 470) + 40)
  // Corals take color from the palette: warm coral by day, cool violet by night.
  const [dr, , db] = pixel(day, 85, 380)
  expect(dr!).toBeGreaterThan(db!)
  const [nr, , nb] = pixel(night, 85, 380)
  expect(nb!).toBeGreaterThan(nr!)
})

test.each(["reef-day", "reef-night"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderReefPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})

test("oversize frames are bound to 1920x1080", () => {
  const frame = renderReefPixels(3840, 2160, "reef-day", 700)
  expect(frame).toHaveLength(1920 * 1080 * 3)
})
