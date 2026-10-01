import { expect, test } from "vitest"
import { renderDomesPixels } from "../../../src/cli/tui/component/domes-pixels"
import { renderTextScenePixels } from "../../../src/cli/tui/component/text-scene-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test("domes-snow paints falling snow from elapsed time", () => {
  const first = renderDomesPixels(WIDTH, HEIGHT, "domes-snow", 0)
  const moving = renderDomesPixels(WIDTH, HEIGHT, "domes-snow", 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(first.equals(moving)).toBe(false)
  expect(renderDomesPixels(WIDTH, HEIGHT, "domes-snow", 900).equals(moving)).toBe(true)
  expect(renderDomesPixels(WIDTH, HEIGHT, "domes-snow", -100).equals(first)).toBe(true)
  expect(pixel(first, 0, 0)).toEqual([184, 196, 220])
  // Wall plaster never moves.
  expect(pixel(first, 350, 300)).toEqual([216, 220, 226])
  expect(pixel(moving, 350, 300)).toEqual([216, 220, 226])
  // An evergreen flanks the church.
  expect(pixel(first, 50, 330)).toEqual([42, 90, 58])
  // The bell-arch leg on the first frame.
  expect(pixel(first, 85, 290)).toEqual([154, 162, 174])
})

test("domes-clear holds its frame still", () => {
  const first = renderDomesPixels(WIDTH, HEIGHT, "domes-clear", 0)
  expect(renderDomesPixels(WIDTH, HEIGHT, "domes-clear", 900).equals(first)).toBe(true)
  expect(pixel(first, 0, 0)).toEqual([126, 192, 228])
  expect(pixel(first, 350, 300)).toEqual([238, 241, 245])
  expect(pixel(first, 50, 330)).toEqual([44, 106, 68])
  expect(pixel(first, 85, 290)).toEqual([170, 178, 190])
})

test.each(["domes-snow", "domes-clear"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderDomesPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
  // The scene dispatcher routes to this renderer.
  expect(renderTextScenePixels(WIDTH, HEIGHT, style, 700).equals(renderDomesPixels(WIDTH, HEIGHT, style, 700))).toBe(
    true,
  )
})
