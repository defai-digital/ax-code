import { expect, test } from "vitest"
import { renderRacingPixels } from "../../../src/cli/tui/component/racing-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["racing-day", "racing-night"] as const)("%s paints deterministically from elapsed time", (style) => {
  const first = renderRacingPixels(WIDTH, HEIGHT, style, 0)
  const moving = renderRacingPixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(moving.equals(renderRacingPixels(WIDTH, HEIGHT, style, 900))).toBe(true)
  expect(renderRacingPixels(WIDTH, HEIGHT, style, 2400).equals(first)).toBe(true)
  expect(renderRacingPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  expect(moving.equals(first)).toBe(false)
  // The mountain shoulder never moves, and it is not sky.
  expect(pixel(moving, 80, 120)).toEqual(pixel(first, 80, 120))
  expect(pixel(first, 80, 120)).not.toEqual(pixel(first, 380, 0))
})

test.each(["racing-day", "racing-night"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderRacingPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})
