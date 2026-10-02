import { expect, test } from "vitest"
import { renderTaegeukPixels } from "../../../src/cli/tui/component/taegeuk-pixels"
import { renderTextScenePixels } from "../../../src/cli/tui/component/text-scene-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["taegeuk"] as const)("%s paints deterministically from elapsed time", (style) => {
  const first = renderTaegeukPixels(WIDTH, HEIGHT, style, 0)
  const moving = renderTaegeukPixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(moving.equals(renderTaegeukPixels(WIDTH, HEIGHT, style, 900))).toBe(true)
  expect(renderTaegeukPixels(WIDTH, HEIGHT, style, 900).equals(moving)).toBe(true)
  expect(renderTaegeukPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  // A floodlight pylon mast never moves.
  expect(pixel(first, 15, 330)).toEqual([44, 44, 58])
  expect(pixel(moving, 15, 330)).toEqual([44, 44, 58])
  // The scene dispatcher routes to this renderer.
  expect(renderTextScenePixels(WIDTH, HEIGHT, style, 700).equals(renderTaegeukPixels(WIDTH, HEIGHT, style, 700))).toBe(
    true,
  )
})

test.each(["taegeuk"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderTaegeukPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})

test("the settled flag matches the official construction sheet", () => {
  // The 54x18-cell field maps to 540x360 pixels centered on (380, 200): 3.75 pixels per flag unit.
  const flagPixel = (frame: Buffer, x: number, y: number) =>
    pixel(frame, Math.floor(380 + x * 3.75), Math.floor(200 + y * 3.75))
  const white = [255, 255, 255]
  const red = [205, 46, 58]
  const blue = [0, 71, 160]
  const black = [0, 0, 0]
  for (const elapsed of [0, 3000, 60_000]) {
    const frame = renderTaegeukPixels(WIDTH, HEIGHT, "taegeuk", elapsed)
    // White 3:2 field with the sky outside it.
    expect(flagPixel(frame, -71, -47)).toEqual(white)
    expect(flagPixel(frame, 71, 47)).toEqual(white)
    expect(flagPixel(frame, -73, 0)).not.toEqual(white)
    // Red over blue, heads interlocked, no outline ring.
    expect(flagPixel(frame, 0, -20)).toEqual(red)
    expect(flagPixel(frame, 0, 20)).toEqual(blue)
    expect(flagPixel(frame, -12, 1)).toEqual(red)
    expect(flagPixel(frame, 12, -1)).toEqual(blue)
    expect(flagPixel(frame, 0, -23)).toEqual(red)
    expect(flagPixel(frame, 0, -25)).toEqual(white)
    // Middle bars: geon and gam solid, ri and gon broken.
    expect(flagPixel(frame, -36.6, -24.4)).toEqual(black)
    expect(flagPixel(frame, 36.6, -24.4)).toEqual(black)
    expect(flagPixel(frame, -36.6, 24.4)).toEqual(white)
    expect(flagPixel(frame, 36.6, 24.4)).toEqual(white)
  }
  // Confetti crosses behind the flag without marking the field.
  const confettiCell = renderTaegeukPixels(WIDTH, HEIGHT, "taegeuk", 0)
  expect(pixel(confettiCell, 345, 230)).toEqual(blue)
})
