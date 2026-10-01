import { expect, test } from "vitest"
import { renderBorobudurPixels } from "../../../src/cli/tui/component/borobudur-pixels"
import { renderTextScenePixels } from "../../../src/cli/tui/component/text-scene-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["borobudur-mist", "borobudur-noon"] as const)("%s paints the terraces from elapsed time", (style) => {
  const mist = style === "borobudur-mist"
  const first = renderBorobudurPixels(WIDTH, HEIGHT, style, 0)
  const moving = renderBorobudurPixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(first.equals(moving)).toBe(false)
  expect(renderBorobudurPixels(WIDTH, HEIGHT, style, 450).equals(first)).toBe(false)
  expect(renderBorobudurPixels(WIDTH, HEIGHT, style, 900).equals(moving)).toBe(true)
  expect(renderBorobudurPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  expect(pixel(first, 0, 0)).toEqual(mist ? [180, 188, 188] : [126, 192, 228])
  // Tier stone above the mist line never moves.
  const stone: readonly [number, number, number] = mist ? [122, 114, 104] : [154, 138, 114]
  expect(pixel(first, 300, 280)).toEqual(stone)
  expect(pixel(moving, 300, 280)).toEqual(stone)
  // A palm trunk flanks the terraces.
  const trunk: readonly [number, number, number] = mist ? [62, 90, 58] : [42, 90, 42]
  expect(pixel(first, 70, 270)).toEqual(trunk)
  expect(pixel(moving, 70, 270)).toEqual(trunk)
  // The volcano cone never moves.
  const cone: readonly [number, number, number] = mist ? [106, 112, 120] : [90, 106, 122]
  expect(pixel(first, 60, 190)).toEqual(cone)
  expect(pixel(moving, 60, 190)).toEqual(cone)
  // The scene dispatcher routes to this renderer.
  expect(
    renderTextScenePixels(WIDTH, HEIGHT, style, 700).equals(renderBorobudurPixels(WIDTH, HEIGHT, style, 700)),
  ).toBe(true)
})

test.each(["borobudur-mist", "borobudur-noon"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderBorobudurPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})
