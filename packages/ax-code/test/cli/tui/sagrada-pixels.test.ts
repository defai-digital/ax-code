import { expect, test } from "vitest"
import { renderSagradaPixels } from "../../../src/cli/tui/component/sagrada-pixels"
import { renderTextScenePixels } from "../../../src/cli/tui/component/text-scene-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["sagrada-day", "sagrada-night"] as const)("%s paints deterministically from elapsed time", (style) => {
  const day = style === "sagrada-day"
  const first = renderSagradaPixels(WIDTH, HEIGHT, style, 0)
  const moving = renderSagradaPixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(moving.equals(renderSagradaPixels(WIDTH, HEIGHT, style, 900))).toBe(true)
  expect(renderSagradaPixels(WIDTH, HEIGHT, style, 900).equals(moving)).toBe(true)
  expect(renderSagradaPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  // A flower-bed bloom never moves.
  const bloom: readonly [number, number, number] = day ? [195, 106, 138] : [232, 154, 184]
  expect(pixel(first, 45, 450)).toEqual(bloom)
  expect(pixel(moving, 45, 450)).toEqual(bloom)
  // Towers are shaded cylinders: the lit edge differs from the shaded edge.
  expect(pixel(first, 238, 250)).not.toEqual(pixel(first, 262, 250))
  expect(first.equals(moving)).toBe(false)
  // The scene dispatcher routes to this renderer.
  expect(renderTextScenePixels(WIDTH, HEIGHT, style, 700).equals(renderSagradaPixels(WIDTH, HEIGHT, style, 700))).toBe(
    true,
  )
})

test.each(["sagrada-day", "sagrada-night"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderSagradaPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})
