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
  // The scene loops with the shared 2400ms cycle and moves in between.
  expect(renderLighthousePixels(WIDTH, HEIGHT, style, 2400).equals(first)).toBe(true)
  expect(moving.equals(first)).toBe(false)
  // The chalk tower band never moves; it is brighter by day than by moonlight.
  const band = pixel(first, 125, 110)
  expect(pixel(moving, 125, 110)).toEqual(band)
  expect(band[0]).toBeGreaterThan(day ? 200 : 60)
  expect(band[0]).toBeLessThan(day ? 256 : 140)
  // The lantern is lit only at night.
  const lantern = pixel(first, 125, 66)
  if (day) expect(lantern[0]).toBeLessThan(200)
  else expect(lantern[0]! + lantern[1]! + lantern[2]!).toBeGreaterThan(660)
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
