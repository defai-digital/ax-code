import { expect, test } from "vitest"
import { renderPyramidsPixels } from "../../../src/cli/tui/component/pyramids-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["pyramids-day", "pyramids-night"] as const)("%s paints deterministically from elapsed time", (style) => {
  const day = style === "pyramids-day"
  const first = renderPyramidsPixels(WIDTH, HEIGHT, style, 0)
  const moving = renderPyramidsPixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(moving.equals(renderPyramidsPixels(WIDTH, HEIGHT, style, 900))).toBe(true)
  expect(renderPyramidsPixels(WIDTH, HEIGHT, style, 900).equals(moving)).toBe(true)
  expect(renderPyramidsPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  // The great pyramid face never moves.
  const stone: readonly [number, number, number] = day ? [200, 168, 120] : [90, 84, 120]
  expect(pixel(first, 305, 210)).toEqual(stone)
  expect(pixel(moving, 305, 210)).toEqual(stone)
})

test.each(["pyramids-day", "pyramids-night"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderPyramidsPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})
