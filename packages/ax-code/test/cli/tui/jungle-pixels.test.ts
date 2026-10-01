import { expect, test } from "vitest"
import { renderJunglePixels } from "../../../src/cli/tui/component/jungle-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["jungle-day", "jungle-night"] as const)("%s paints deterministically from elapsed time", (style) => {
  const day = style === "jungle-day"
  const first = renderJunglePixels(WIDTH, HEIGHT, style, 0)
  const moving = renderJunglePixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(moving.equals(renderJunglePixels(WIDTH, HEIGHT, style, 900))).toBe(true)
  expect(renderJunglePixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  // The fern ground never moves.
  const ground: readonly [number, number, number] = day ? [74, 106, 52] : [22, 36, 15]
  expect(pixel(first, 385, 450)).toEqual(ground)
  expect(pixel(moving, 385, 450)).toEqual(ground)
})

test.each(["jungle-day", "jungle-night"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderJunglePixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})

test("oversize frames are bound to 1920x1080", () => {
  const frame = renderJunglePixels(3840, 2160, "jungle-day", 700)
  expect(frame).toHaveLength(1920 * 1080 * 3)
})
