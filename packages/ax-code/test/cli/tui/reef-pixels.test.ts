import { expect, test } from "vitest"
import { renderReefPixels } from "../../../src/cli/tui/component/reef-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["reef-day", "reef-night"] as const)("%s paints deterministically from elapsed time", (style) => {
  const day = style === "reef-day"
  const first = renderReefPixels(WIDTH, HEIGHT, style, 0)
  const moving = renderReefPixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(moving.equals(renderReefPixels(WIDTH, HEIGHT, style, 900))).toBe(true)
  expect(renderReefPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  // The shelled sand never moves.
  const sand: readonly [number, number, number] = day ? [232, 216, 168] : [74, 66, 50]
  expect(pixel(first, 385, 450)).toEqual(sand)
  expect(pixel(moving, 385, 450)).toEqual(sand)
})

test.each(["reef-day", "reef-night"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderReefPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})

test("oversize frames are bound to 1920x1080", () => {
  const frame = renderReefPixels(3840, 2160, "reef-day", 700)
  expect(frame).toHaveLength(1920 * 1080 * 3)
})
