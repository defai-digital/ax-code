import { expect, test } from "vitest"
import { renderDinosaurPixels } from "../../../src/cli/tui/component/dinosaur-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["dinosaur-day", "dinosaur-night"] as const)("%s paints deterministically from elapsed time", (style) => {
  const first = renderDinosaurPixels(WIDTH, HEIGHT, style, 0)
  const moving = renderDinosaurPixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(moving.equals(renderDinosaurPixels(WIDTH, HEIGHT, style, 900))).toBe(true)
  expect(renderDinosaurPixels(WIDTH, HEIGHT, style, 3600).equals(first)).toBe(true)
  expect(renderDinosaurPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  expect(moving.equals(first)).toBe(false)
  // The distant hill never moves, and it is not sky.
  expect(pixel(moving, 500, 320)).toEqual(pixel(first, 500, 320))
  expect(pixel(first, 500, 320)).not.toEqual(pixel(first, 500, 0))
})

test.each(["dinosaur-day", "dinosaur-night"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderDinosaurPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})
