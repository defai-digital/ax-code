import { expect, test } from "vitest"
import { renderGreatwallPixels } from "../../../src/cli/tui/component/greatwall-pixels"
import { renderTextScenePixels } from "../../../src/cli/tui/component/text-scene-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["greatwall-dawn", "greatwall-dusk"] as const)("%s paints deterministically from elapsed time", (style) => {
  const dawn = style === "greatwall-dawn"
  const first = renderGreatwallPixels(WIDTH, HEIGHT, style, 0)
  const moving = renderGreatwallPixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(moving.equals(renderGreatwallPixels(WIDTH, HEIGHT, style, 900))).toBe(true)
  expect(renderGreatwallPixels(WIDTH, HEIGHT, style, 900).equals(moving)).toBe(true)
  expect(renderGreatwallPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  // The distant beacon tower never moves.
  const far: readonly [number, number, number] = dawn ? [122, 148, 168] : [138, 90, 106]
  expect(pixel(first, 600, 130)).toEqual(far)
  expect(pixel(moving, 600, 130)).toEqual(far)
  // The scene dispatcher routes to this renderer.
  expect(
    renderTextScenePixels(WIDTH, HEIGHT, style, 700).equals(renderGreatwallPixels(WIDTH, HEIGHT, style, 700)),
  ).toBe(true)
})

test.each(["greatwall-dawn", "greatwall-dusk"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderGreatwallPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})
