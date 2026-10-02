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
  expect(pixel(first, 0, 0)).toEqual(mist ? [184, 191, 191] : [126, 192, 228])
  // The sun and the lawn never move.
  expect(pixel(first, 640, 40)).toEqual(mist ? [242, 236, 216] : [255, 217, 138])
  expect(pixel(moving, 640, 40)).toEqual(pixel(first, 640, 40))
  expect(pixel(moving, 100, 450)).toEqual(pixel(first, 100, 450))
  // Drifting fog moves over the terraces in the mist; noon stone stays crisp.
  if (mist) expect(pixel(first, 300, 280)).not.toEqual(pixel(moving, 300, 280))
  else expect(pixel(first, 300, 280)).toEqual(pixel(moving, 300, 280))
  // Terrace stone is clearly darker than the sky behind the crown.
  const lum = (p: number[]) => p[0]! + p[1]! + p[2]!
  expect(lum(pixel(first, 300, 280))).toBeLessThan(lum(pixel(first, 0, 0)))
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
