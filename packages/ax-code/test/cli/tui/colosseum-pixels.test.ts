import { expect, test } from "vitest"
import { renderColosseumPixels } from "../../../src/cli/tui/component/colosseum-pixels"
import { renderTextScenePixels } from "../../../src/cli/tui/component/text-scene-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["colosseum-day", "colosseum-night"] as const)("%s paints the arcade from elapsed time", (style) => {
  const day = style === "colosseum-day"
  const first = renderColosseumPixels(WIDTH, HEIGHT, style, 0)
  const moving = renderColosseumPixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(first.equals(moving)).toBe(false)
  expect(renderColosseumPixels(WIDTH, HEIGHT, style, 900).equals(moving)).toBe(true)
  expect(renderColosseumPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  expect(pixel(first, 0, 0)).toEqual(day ? [142, 200, 232] : [14, 20, 51])
  // Wall stone between the arches never moves.
  const stone: readonly [number, number, number] = day ? [201, 191, 160] : [90, 86, 72]
  expect(pixel(first, 300, 240)).toEqual(stone)
  expect(pixel(moving, 300, 240)).toEqual(stone)
  // A cypress flanking the ruin never moves.
  const cypress: readonly [number, number, number] = day ? [61, 106, 61] : [30, 58, 36]
  expect(pixel(first, 55, 330)).toEqual(cypress)
  expect(pixel(moving, 55, 330)).toEqual(cypress)
  // A statue standing in a crown gap never moves.
  const statue: readonly [number, number, number] = day ? [94, 86, 69] : [30, 28, 24]
  expect(pixel(first, 325, 140)).toEqual(statue)
  expect(pixel(moving, 325, 140)).toEqual(statue)
  // An umbrella-pine canopy framing the edge never moves.
  const pine: readonly [number, number, number] = day ? [61, 106, 61] : [30, 58, 36]
  expect(pixel(first, 15, 230)).toEqual(pine)
  expect(pixel(moving, 15, 230)).toEqual(pine)
  // A gladiator flanking the gate never moves.
  const crowd: readonly [number, number, number] = day ? [90, 90, 106] : [138, 138, 160]
  expect(pixel(first, 335, 350)).toEqual(crowd)
  expect(pixel(moving, 335, 350)).toEqual(crowd)
  // Tourist cameras take turns flashing.
  const flash: readonly [number, number, number] = day ? [232, 138, 58] : [255, 209, 102]
  expect(pixel(first, 75, 370)).toEqual(flash)
  expect(pixel(first, 275, 370)).toEqual(crowd)
  expect(pixel(moving, 75, 370)).toEqual(crowd)
  expect(pixel(moving, 275, 370)).toEqual(flash)
  // The scene dispatcher routes to this renderer.
  expect(
    renderTextScenePixels(WIDTH, HEIGHT, style, 700).equals(renderColosseumPixels(WIDTH, HEIGHT, style, 700)),
  ).toBe(true)
})

test.each(["colosseum-day", "colosseum-night"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderColosseumPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})
