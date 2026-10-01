import { expect, test } from "vitest"
import { renderCanyonPixels } from "../../../src/cli/tui/component/canyon-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["canyon-day", "canyon-night"] as const)("%s paints deterministically from elapsed time", (style) => {
  const day = style === "canyon-day"
  const first = renderCanyonPixels(WIDTH, HEIGHT, style, 0)
  const moving = renderCanyonPixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(moving.equals(renderCanyonPixels(WIDTH, HEIGHT, style, 900))).toBe(true)
  expect(renderCanyonPixels(WIDTH, HEIGHT, style, 2400).equals(first)).toBe(true)
  expect(renderCanyonPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  expect(moving.equals(first)).toBe(false)
  // The top strata band never moves.
  const strata: readonly [number, number, number] = day ? [184, 104, 60] : [58, 42, 58]
  expect(pixel(first, 380, 160)).toEqual(strata)
  expect(pixel(moving, 380, 160)).toEqual(strata)
})

test.each(["canyon-day", "canyon-night"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderCanyonPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})
