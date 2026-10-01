import { expect, test } from "vitest"
import { renderCorcovadoPixels } from "../../../src/cli/tui/component/corcovado-pixels"
import { renderTextScenePixels } from "../../../src/cli/tui/component/text-scene-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["corcovado-day", "corcovado-gold"] as const)("%s paints deterministically from elapsed time", (style) => {
  const day = style === "corcovado-day"
  const first = renderCorcovadoPixels(WIDTH, HEIGHT, style, 0)
  const moving = renderCorcovadoPixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(moving.equals(renderCorcovadoPixels(WIDTH, HEIGHT, style, 900))).toBe(true)
  expect(renderCorcovadoPixels(WIDTH, HEIGHT, style, 900).equals(moving)).toBe(true)
  expect(renderCorcovadoPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  // An umbrella pole on the promenade never moves.
  const pole: readonly [number, number, number] = day ? [255, 225, 78] : [255, 209, 102]
  expect(pixel(first, 85, 430)).toEqual(pole)
  expect(pixel(moving, 85, 430)).toEqual(pole)
  // The scene dispatcher routes to this renderer.
  expect(
    renderTextScenePixels(WIDTH, HEIGHT, style, 700).equals(renderCorcovadoPixels(WIDTH, HEIGHT, style, 700)),
  ).toBe(true)
})

test.each(["corcovado-day", "corcovado-gold"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderCorcovadoPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})
