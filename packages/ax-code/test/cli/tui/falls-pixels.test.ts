import { expect, test } from "vitest"
import { renderFallsPixels } from "../../../src/cli/tui/component/falls-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["falls-day", "falls-moon"] as const)("%s paints deterministically from elapsed time", (style) => {
  const day = style === "falls-day"
  const first = renderFallsPixels(WIDTH, HEIGHT, style, 0)
  const moving = renderFallsPixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(moving.equals(renderFallsPixels(WIDTH, HEIGHT, style, 900))).toBe(true)
  expect(renderFallsPixels(WIDTH, HEIGHT, style, 2400).equals(first)).toBe(true)
  expect(renderFallsPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  expect(moving.equals(first)).toBe(false)
  // The left gorge wall never moves, and the lit wall is brighter by day than by night.
  expect(pixel(moving, 160, 220)).toEqual(pixel(first, 160, 220))
  const lum = (p: number[]) => p[0]! + p[1]! + p[2]!
  expect(lum(pixel(first, 160, 220))).toBeGreaterThan(day ? 150 : 60)
  expect(lum(pixel(first, 160, 220))).toBeLessThan(day ? 400 : 200)
  // The cascade is brighter than the shaded wall beside it.
  expect(lum(pixel(first, 380, 220))).toBeGreaterThan(lum(pixel(first, 160, 220)))
})

test.each(["falls-day", "falls-moon"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderFallsPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})
