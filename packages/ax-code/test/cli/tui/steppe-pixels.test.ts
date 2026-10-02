import { expect, test } from "vitest"
import { renderSteppePixels } from "../../../src/cli/tui/component/steppe-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["steppe-day", "steppe-night"] as const)("%s paints deterministically from elapsed time", (style) => {
  const day = style === "steppe-day"
  const first = renderSteppePixels(WIDTH, HEIGHT, style, 0)
  const moving = renderSteppePixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(moving.equals(renderSteppePixels(WIDTH, HEIGHT, style, 900))).toBe(true)
  expect(renderSteppePixels(WIDTH, HEIGHT, style, 2400).equals(first)).toBe(true)
  expect(renderSteppePixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  expect(moving.equals(first)).toBe(false)
  // The soil band at the bottom edge never moves and stays green-dominant.
  const soil = pixel(first, 50, 470)
  expect(pixel(moving, 50, 470)).toEqual(soil)
  expect(soil[1]!).toBeGreaterThan(soil[0]!)
  expect(soil[1]!).toBeGreaterThan(soil[2]!)
  // The zenith is bright by day and dark by night.
  const zenith = pixel(first, 380, 2).reduce((a, b) => a + b, 0)
  if (day) expect(zenith).toBeGreaterThan(300)
  else expect(zenith).toBeLessThan(120)
})

test.each(["steppe-day", "steppe-night"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderSteppePixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})
