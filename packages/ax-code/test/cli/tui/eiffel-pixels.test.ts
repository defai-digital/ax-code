import { expect, test } from "vitest"
import { renderEiffelPixels } from "../../../src/cli/tui/component/eiffel-pixels"
import { renderTextScenePixels } from "../../../src/cli/tui/component/text-scene-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["eiffel-day", "eiffel-night"] as const)("%s paints deterministically from elapsed time", (style) => {
  const day = style === "eiffel-day"
  const first = renderEiffelPixels(WIDTH, HEIGHT, style, 0)
  const moving = renderEiffelPixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(moving.equals(renderEiffelPixels(WIDTH, HEIGHT, style, 900))).toBe(true)
  expect(renderEiffelPixels(WIDTH, HEIGHT, style, 900).equals(moving)).toBe(true)
  expect(renderEiffelPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  // A rooftop chimney behind the legs never moves.
  const roof: readonly [number, number, number] = day ? [138, 122, 104] : [44, 42, 52]
  expect(pixel(first, 45, 350)).toEqual(roof)
  expect(pixel(moving, 45, 350)).toEqual(roof)
  // The scene dispatcher routes to this renderer.
  expect(renderTextScenePixels(WIDTH, HEIGHT, style, 700).equals(renderEiffelPixels(WIDTH, HEIGHT, style, 700))).toBe(
    true,
  )
})

test.each(["eiffel-day", "eiffel-night"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderEiffelPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})
