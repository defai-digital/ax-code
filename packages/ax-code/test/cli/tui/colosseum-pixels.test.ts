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
  const sum = (p: number[]) => p[0]! + p[1]! + p[2]!
  // The zenith is sky; the lawn below the horizon is not.
  expect(pixel(first, 0, 0)).not.toEqual(pixel(first, 0, 470))
  // The arcade: deep shaded openings by day, glowing amber openings at night.
  let openings = 0
  for (let y = 230; y < 330; y++) {
    for (let x = 160; x < 600; x++) {
      const p = pixel(first, x, y)
      if (day ? sum(p) < 250 : p[0]! > 200 && p[1]! > 120 && p[2]! < 120) openings++
    }
  }
  expect(openings).toBeGreaterThan(1500)
  // A cypress flanking the ruin never moves.
  expect(pixel(moving, 55, 330)).toEqual(pixel(first, 55, 330))
  // The gate steps and a gladiator flanking the gate never move.
  expect(pixel(moving, 335, 350)).toEqual(pixel(first, 335, 350))
  // Tourist cameras take turns flashing: camera 0 is bright at t=0 and camera 1 at t=400.
  const early = renderColosseumPixels(WIDTH, HEIGHT, style, 400)
  expect(sum(pixel(first, 79, 366))).toBeGreaterThan(sum(pixel(moving, 79, 366)))
  expect(sum(pixel(early, 209, 366))).toBeGreaterThan(sum(pixel(first, 209, 366)))
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
