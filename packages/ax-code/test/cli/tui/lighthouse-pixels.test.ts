import { expect, test } from "vitest"
import { renderLighthousePixels } from "../../../src/cli/tui/component/lighthouse-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["lighthouse-day", "lighthouse-night"] as const)("%s paints deterministically from elapsed time", (style) => {
  const day = style === "lighthouse-day"
  const first = renderLighthousePixels(WIDTH, HEIGHT, style, 0)
  const moving = renderLighthousePixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(moving.equals(renderLighthousePixels(WIDTH, HEIGHT, style, 900))).toBe(true)
  expect(renderLighthousePixels(WIDTH, HEIGHT, style, 900).equals(moving)).toBe(true)
  expect(renderLighthousePixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  // The chalk tower band never moves.
  const chalk: readonly [number, number, number] = day ? [242, 240, 232] : [138, 138, 154]
  expect(pixel(first, 125, 110)).toEqual(chalk)
  expect(pixel(moving, 125, 110)).toEqual(chalk)
})

test.each(["lighthouse-day", "lighthouse-night"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderLighthousePixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})
