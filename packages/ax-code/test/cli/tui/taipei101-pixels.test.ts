import { expect, test } from "vitest"
import { renderTaipei101Pixels } from "../../../src/cli/tui/component/taipei101-pixels"
import { renderTextScenePixels } from "../../../src/cli/tui/component/text-scene-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["taipei101-day", "taipei101-neon"] as const)("%s paints deterministically from elapsed time", (style) => {
  const day = style === "taipei101-day"
  const first = renderTaipei101Pixels(WIDTH, HEIGHT, style, 0)
  const moving = renderTaipei101Pixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(moving.equals(renderTaipei101Pixels(WIDTH, HEIGHT, style, 900))).toBe(true)
  expect(renderTaipei101Pixels(WIDTH, HEIGHT, style, 900).equals(moving)).toBe(true)
  expect(renderTaipei101Pixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  // The elevated track behind the tower never moves.
  const track: readonly [number, number, number] = day ? [61, 90, 115] : [255, 90, 208]
  expect(pixel(first, 100, 270)).toEqual(track)
  expect(pixel(moving, 100, 270)).toEqual(track)
  // The tower is shaded glass, not a flat fill: the lit and shaded edges differ.
  expect(pixel(first, 372, 330)).not.toEqual(pixel(first, 398, 330))
  // The window chase animates the tower.
  expect(first.equals(moving)).toBe(false)
  // The scene dispatcher routes to this renderer.
  expect(
    renderTextScenePixels(WIDTH, HEIGHT, style, 700).equals(renderTaipei101Pixels(WIDTH, HEIGHT, style, 700)),
  ).toBe(true)
})

test.each(["taipei101-day", "taipei101-neon"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderTaipei101Pixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})
