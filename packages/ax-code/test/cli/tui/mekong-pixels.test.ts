import { expect, test } from "vitest"
import { renderMekongPixels } from "../../../src/cli/tui/component/mekong-pixels"
import { renderTextScenePixels } from "../../../src/cli/tui/component/text-scene-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

const lum = (frame: Buffer, x: number, y: number) => {
  const [r, g, b] = pixel(frame, x, y)
  return 0.299 * r! + 0.587 * g! + 0.114 * b!
}

test.each(["mekong-dawn", "mekong-dusk"] as const)("%s paints the river from elapsed time", (style) => {
  const dawn = style === "mekong-dawn"
  const first = renderMekongPixels(WIDTH, HEIGHT, style, 0)
  const moving = renderMekongPixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(first.equals(moving)).toBe(false)
  expect(renderMekongPixels(WIDTH, HEIGHT, style, 900).equals(moving)).toBe(true)
  expect(renderMekongPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  // The sky is brighter than the deep river, and the sun outshines the sky.
  expect(lum(first, 300, 40)).toBeGreaterThan(lum(first, 300, 460))
  expect(lum(first, 600, 80)).toBeGreaterThan(lum(first, 300, 40))
  // The sun's glitter path lights the water beneath it, more than open water beside it.
  expect(lum(first, 600, 400)).toBeGreaterThan(lum(first, 300, 400) + 30)
  // Dawn is cooler than dusk in the sky overhead.
  const [r, , b] = pixel(first, 300, 40)
  if (dawn) expect(b!).toBeGreaterThan(r! - 10)
  else expect(r!).toBeGreaterThan(b!)
  // The temple spire and hall never move.
  expect(pixel(first, 160, 250)).toEqual(pixel(moving, 160, 250))
  // The market boat drifts: its goods leave the right edge of the frame.
  expect(pixel(first, 725, 290)).not.toEqual(pixel(moving, 725, 290))
  // The scene dispatcher routes to this renderer.
  expect(renderTextScenePixels(WIDTH, HEIGHT, style, 700).equals(renderMekongPixels(WIDTH, HEIGHT, style, 700))).toBe(
    true,
  )
})

test.each(["mekong-dawn", "mekong-dusk"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderMekongPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})
