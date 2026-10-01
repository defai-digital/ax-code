import { expect, test } from "vitest"
import { renderBalloonsPixels } from "../../../src/cli/tui/component/balloons-pixels"
import { renderTextScenePixels } from "../../../src/cli/tui/component/text-scene-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["balloons-night", "balloons-dawn"] as const)("%s paints the ascent from elapsed time", (style) => {
  const night = style === "balloons-night"
  const first = renderBalloonsPixels(WIDTH, HEIGHT, style, 0)
  const moving = renderBalloonsPixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(first.equals(moving)).toBe(false)
  expect(renderBalloonsPixels(WIDTH, HEIGHT, style, 900).equals(moving)).toBe(true)
  expect(renderBalloonsPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  expect(pixel(first, 0, 0)).toEqual(night ? [14, 20, 51] : [184, 122, 106])
  // Valley ground never moves.
  const ground: readonly [number, number, number] = night ? [28, 30, 46] : [90, 74, 58]
  expect(pixel(first, 100, 430)).toEqual(ground)
  expect(pixel(moving, 100, 430)).toEqual(ground)
  // The moonrise above the lanes never moves.
  const moon: readonly [number, number, number] = night ? [232, 228, 245] : [255, 248, 232]
  expect(pixel(first, 665, 70)).toEqual(moon)
  expect(pixel(moving, 665, 70)).toEqual(moon)
  // A valley cottage never moves.
  const cottage: readonly [number, number, number] = night ? [255, 209, 102] : [138, 106, 82]
  expect(pixel(first, 305, 370)).toEqual(cottage)
  expect(pixel(moving, 305, 370)).toEqual(cottage)
  // The scene dispatcher routes to this renderer.
  expect(renderTextScenePixels(WIDTH, HEIGHT, style, 700).equals(renderBalloonsPixels(WIDTH, HEIGHT, style, 700))).toBe(
    true,
  )
})

test.each(["balloons-night", "balloons-dawn"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderBalloonsPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})
