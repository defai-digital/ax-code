import { expect, test } from "vitest"
import { renderTaegeukPixels } from "../../../src/cli/tui/component/taegeuk-pixels"
import { renderTextScenePixels } from "../../../src/cli/tui/component/text-scene-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["taegeuk"] as const)("%s paints deterministically from elapsed time", (style) => {
  const first = renderTaegeukPixels(WIDTH, HEIGHT, style, 0)
  const moving = renderTaegeukPixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(moving.equals(renderTaegeukPixels(WIDTH, HEIGHT, style, 900))).toBe(true)
  expect(renderTaegeukPixels(WIDTH, HEIGHT, style, 900).equals(moving)).toBe(true)
  expect(renderTaegeukPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  // A floodlight pylon mast never moves.
  expect(pixel(first, 15, 330)).toEqual([44, 44, 58])
  expect(pixel(moving, 15, 330)).toEqual([44, 44, 58])
  // The scene dispatcher routes to this renderer.
  expect(renderTextScenePixels(WIDTH, HEIGHT, style, 700).equals(renderTaegeukPixels(WIDTH, HEIGHT, style, 700))).toBe(
    true,
  )
})

test.each(["taegeuk"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderTaegeukPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})
