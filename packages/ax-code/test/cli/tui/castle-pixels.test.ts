import { expect, test } from "vitest"
import { renderCastlePixels } from "../../../src/cli/tui/component/castle-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["castle-day", "castle-night"] as const)("%s paints deterministically from elapsed time", (style) => {
  const day = style === "castle-day"
  const first = renderCastlePixels(WIDTH, HEIGHT, style, 0)
  const moving = renderCastlePixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(first.equals(moving)).toBe(false)
  expect(renderCastlePixels(WIDTH, HEIGHT, style, 900).equals(moving)).toBe(true)
  expect(renderCastlePixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  expect(renderCastlePixels(WIDTH, HEIGHT, style, 2400).equals(first)).toBe(true)
  // The keep wall never moves.
  const wall: readonly [number, number, number] = day ? [184, 176, 160] : [110, 106, 126]
  expect(pixel(first, 375, 250)).toEqual(wall)
  expect(pixel(moving, 375, 250)).toEqual(wall)
})

test("the rooftop beacon blinks red over the night keep", () => {
  expect(pixel(renderCastlePixels(WIDTH, HEIGHT, "castle-night", 0), 275, 130)).toEqual([255, 82, 82])
  expect(pixel(renderCastlePixels(WIDTH, HEIGHT, "castle-night", 500), 275, 130)).toEqual([74, 70, 88])
})

test.each(["castle-day", "castle-night"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderCastlePixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})
