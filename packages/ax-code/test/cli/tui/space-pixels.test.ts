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
  expect(renderSpacePixels(WIDTH, HEIGHT, style, 2400).equals(first)).toBe(true)
  // The top-left pixel samples the sky gradient start.
  expect(pixel(first, 0, 0)).toEqual(launch ? [16, 26, 58] : [4, 6, 15])
  // The planet limb never moves.
  const limb: readonly [number, number, number] = launch ? [61, 90, 138] : [42, 58, 94]
  expect(pixel(first, 380, 450)).toEqual(limb)
  expect(pixel(moving, 380, 450)).toEqual(limb)
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
