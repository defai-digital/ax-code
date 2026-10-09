import { expect, test } from "vitest"
import { renderSpacePixels } from "../../../src/cli/tui/component/space-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["space-launch", "space-drift"] as const)("%s paints deterministically from elapsed time", (style) => {
  const launch = style === "space-launch"
  const first = renderSpacePixels(WIDTH, HEIGHT, style, 0)
  const moving = renderSpacePixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(first.equals(moving)).toBe(false)
  expect(renderSpacePixels(WIDTH, HEIGHT, style, 900).equals(moving)).toBe(true)
  expect(renderSpacePixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  const settled = renderSpacePixels(WIDTH, HEIGHT, style, 2400)
  expect(settled.equals(first)).toBe(!launch)
  expect(renderSpacePixels(WIDTH, HEIGHT, style, 4800).equals(settled)).toBe(true)
  // The top-left pixel samples the sky gradient start.
  expect(pixel(first, 0, 0)).toEqual(launch ? [16, 26, 58] : [4, 6, 15])
  // The planet surface deep below the limb never moves and reads as blue ocean.
  const surface = pixel(first, 600, 470)
  expect(pixel(moving, 600, 470)).toEqual(surface)
  expect(surface[2]!).toBeGreaterThan(surface[0]!)
  // The launch sky glows warm at the horizon; the drift sky stays near black up high.
  const sky = pixel(first, 100, 300)
  if (launch) expect(sky[0]!).toBeGreaterThan(sky[2]!)
  else expect(sky.reduce((a, b) => a + b, 0)).toBeLessThan(150)
})

test.each(["space-launch", "space-drift"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderSpacePixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})
