import { expect, test } from "vitest"
import { renderMekongPixels } from "../../../src/cli/tui/component/mekong-pixels"
import { renderTextScenePixels } from "../../../src/cli/tui/component/text-scene-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["mekong-dawn", "mekong-dusk"] as const)("%s paints the river from elapsed time", (style) => {
  const dawn = style === "mekong-dawn"
  const first = renderMekongPixels(WIDTH, HEIGHT, style, 0)
  const moving = renderMekongPixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(first.equals(moving)).toBe(false)
  expect(renderMekongPixels(WIDTH, HEIGHT, style, 900).equals(moving)).toBe(true)
  expect(renderMekongPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  expect(pixel(first, 0, 0)).toEqual(dawn ? [168, 196, 224] : [122, 74, 98])
  // Open water away from the crest pattern holds its tone.
  const water: readonly [number, number, number] = dawn ? [74, 138, 154] : [90, 74, 122]
  expect(pixel(first, 105, 330)).toEqual(water)
  // The distant skiff holding still upstream.
  const skiff: readonly [number, number, number] = dawn ? [106, 74, 50] : [74, 50, 34]
  expect(pixel(first, 520, 270)).toEqual(skiff)
  expect(pixel(moving, 520, 270)).toEqual(skiff)
  // The riverside temple never moves.
  const temple: readonly [number, number, number] = dawn ? [138, 106, 74] : [90, 66, 50]
  expect(pixel(first, 160, 250)).toEqual(temple)
  expect(pixel(moving, 160, 250)).toEqual(temple)
  // The market boat's goods drift away, leaving open water behind.
  const goods: readonly [number, number, number] = dawn ? [232, 138, 58] : [195, 106, 42]
  expect(pixel(first, 725, 290)).toEqual(goods)
  expect(pixel(moving, 725, 290)).toEqual(water)
  // A lily pad resting on the lower river never moves.
  const lily: readonly [number, number, number] = dawn ? [74, 138, 74] : [58, 106, 58]
  expect(pixel(first, 485, 410)).toEqual(lily)
  expect(pixel(moving, 485, 410)).toEqual(lily)
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
