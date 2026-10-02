import { expect, test } from "vitest"
import { renderPyramidsPixels } from "../../../src/cli/tui/component/pyramids-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]
const lum = (frame: Buffer, x: number, y: number) => {
  const [r, g, b] = pixel(frame, x, y)
  return 0.299 * r! + 0.587 * g! + 0.114 * b!
}

test.each(["pyramids-day", "pyramids-night"] as const)("%s paints deterministically and loops", (style) => {
  const first = renderPyramidsPixels(WIDTH, HEIGHT, style, 0)
  const moving = renderPyramidsPixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(moving.equals(renderPyramidsPixels(WIDTH, HEIGHT, style, 900))).toBe(true)
  expect(first.equals(moving)).toBe(false)
  expect(renderPyramidsPixels(WIDTH, HEIGHT, style, 2400).equals(first)).toBe(true)
  expect(renderPyramidsPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  // The great pyramid mass never moves with the caravan.
  expect(pixel(first, 300, 200)).toEqual(pixel(moving, 300, 200))
})

test("the great pyramid is lit on the side facing the light", () => {
  // Scene (30, 6) is the apex; sample both faces at the same height.
  const day = renderPyramidsPixels(WIDTH, HEIGHT, "pyramids-day", 0)
  expect(lum(day, 340, 230)).toBeGreaterThan(lum(day, 260, 230) + 20)
  const night = renderPyramidsPixels(WIDTH, HEIGHT, "pyramids-night", 0)
  expect(lum(night, 260, 230)).toBeGreaterThan(lum(night, 340, 230) + 20)
})

test("day and night differ in sky and the campfire flickers only at night", () => {
  const day = renderPyramidsPixels(WIDTH, HEIGHT, "pyramids-day", 0)
  const night = renderPyramidsPixels(WIDTH, HEIGHT, "pyramids-night", 0)
  expect(lum(day, 380, 20)).toBeGreaterThan(lum(night, 380, 20) + 80)
  // The flame is warm and bright at rest, then drops on the next flicker beat.
  const calm = renderPyramidsPixels(WIDTH, HEIGHT, "pyramids-night", 200)
  const [r, , b] = pixel(night, 212, 280)
  expect(r!).toBeGreaterThan(b! + 100)
  expect(pixel(calm, 212, 280)).not.toEqual(pixel(night, 212, 280))
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
