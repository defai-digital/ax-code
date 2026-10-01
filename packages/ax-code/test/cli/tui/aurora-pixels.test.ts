import { expect, test } from "vitest"
import { renderAuroraPixels } from "../../../src/cli/tui/component/aurora-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["aurora-night", "aurora-dawn"] as const)("%s paints deterministically from elapsed time", (style) => {
  const night = style === "aurora-night"
  const first = renderAuroraPixels(WIDTH, HEIGHT, style, 0)
  const moving = renderAuroraPixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(moving.equals(renderAuroraPixels(WIDTH, HEIGHT, style, 900))).toBe(true)
  expect(renderAuroraPixels(WIDTH, HEIGHT, style, 900).equals(moving)).toBe(true)
  expect(renderAuroraPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  // The open lake between reflections never moves.
  const water: readonly [number, number, number] = night ? [89, 118, 162] : [164, 133, 163]
  expect(pixel(first, 305, 370)).toEqual(water)
  expect(pixel(moving, 305, 370)).toEqual(water)
})

test.each(["aurora-night", "aurora-dawn"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderAuroraPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})
