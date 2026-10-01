import { expect, test } from "vitest"
import { renderToriiPixels } from "../../../src/cli/tui/component/torii-pixels"
import { renderTextScenePixels } from "../../../src/cli/tui/component/text-scene-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["torii-day", "torii-night"] as const)("%s paints deterministically from elapsed time", (style) => {
  const day = style === "torii-day"
  const first = renderToriiPixels(WIDTH, HEIGHT, style, 0)
  const moving = renderToriiPixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(moving.equals(renderToriiPixels(WIDTH, HEIGHT, style, 900))).toBe(true)
  expect(renderToriiPixels(WIDTH, HEIGHT, style, 900).equals(moving)).toBe(true)
  expect(renderToriiPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  // The shrine wall through the gate never moves.
  const shrine: readonly [number, number, number] = day ? [195, 61, 30] : [138, 42, 24]
  expect(pixel(first, 350, 250)).toEqual(shrine)
  expect(pixel(moving, 350, 250)).toEqual(shrine)
  // The scene dispatcher routes to this renderer.
  expect(renderTextScenePixels(WIDTH, HEIGHT, style, 700).equals(renderToriiPixels(WIDTH, HEIGHT, style, 700))).toBe(
    true,
  )
})

test.each(["torii-day", "torii-night"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderToriiPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})
