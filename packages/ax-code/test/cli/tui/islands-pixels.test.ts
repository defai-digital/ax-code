import { expect, test } from "vitest"
import { renderIslandsPixels } from "../../../src/cli/tui/component/islands-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["islands-day", "islands-dusk"] as const)("%s paints deterministically from elapsed time", (style) => {
  const day = style === "islands-day"
  const first = renderIslandsPixels(WIDTH, HEIGHT, style, 0)
  const moving = renderIslandsPixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(moving.equals(renderIslandsPixels(WIDTH, HEIGHT, style, 900))).toBe(true)
  expect(renderIslandsPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  // Deep water never moves.
  const deep: readonly [number, number, number] = day ? [35, 87, 114] : [46, 33, 75]
  expect(pixel(first, 385, 450)).toEqual(deep)
  expect(pixel(moving, 385, 450)).toEqual(deep)
})

test.each(["islands-day", "islands-dusk"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderIslandsPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})

test("oversize frames are bound to 1920x1080", () => {
  const frame = renderIslandsPixels(3840, 2160, "islands-day", 700)
  expect(frame).toHaveLength(1920 * 1080 * 3)
})
