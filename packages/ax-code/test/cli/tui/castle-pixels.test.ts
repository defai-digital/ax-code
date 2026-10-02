import { expect, test } from "vitest"
import { renderCastlePixels } from "../../../src/cli/tui/component/castle-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["castle-day", "castle-night"] as const)("%s paints deterministically from elapsed time", (style) => {
  const day = style === "castle-day"
  const first = renderCastlePixels(WIDTH, HEIGHT, style, 0)
  const moving = renderCastlePixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(first.equals(moving)).toBe(false)
  expect(renderCastlePixels(WIDTH, HEIGHT, style, 900).equals(moving)).toBe(true)
  expect(renderCastlePixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  expect(renderCastlePixels(WIDTH, HEIGHT, style, 2400).equals(first)).toBe(true)
  // The keep wall never moves and is stone, not sky.
  expect(pixel(moving, 375, 250)).toEqual(pixel(first, 375, 250))
  expect(pixel(first, 375, 250)).not.toEqual(pixel(first, 375, 20))
  // The wall is lit by the sun by day and is darker under the moon.
  const wall = pixel(first, 375, 250)
  expect(wall[0]! + wall[1]! + wall[2]!).toBeGreaterThan(day ? 300 : 150)
})

test("the rooftop beacon blinks red over the night keep", () => {
  const on = pixel(renderCastlePixels(WIDTH, HEIGHT, "castle-night", 0), 280, 130)
  const off = pixel(renderCastlePixels(WIDTH, HEIGHT, "castle-night", 500), 280, 130)
  expect(on[0]).toBeGreaterThan(on[1]! + 120)
  expect(off[0]).toBeLessThan(on[0]! - 80)
})

test.each(["castle-day", "castle-night"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderCastlePixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})
