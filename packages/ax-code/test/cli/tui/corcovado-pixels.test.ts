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
  const sum = (p: number[]) => p[0]! + p[1]! + p[2]!
  // The summit statue is paler than the forested slope below it and never moves.
  const statue = pixel(first, 380, 90)
  expect(sum(statue)).toBeGreaterThan(sum(pixel(first, 380, 300)))
  expect(pixel(moving, 380, 90)).toEqual(statue)
  // The forested slope is greener than it is red.
  const slope = pixel(first, 330, 300)
  expect(slope[1]).toBeGreaterThanOrEqual(slope[0]!)
  // The ending is the warm dusk variant: its sky leans red, the day sky leans blue.
  const sky = pixel(first, 5, 5)
  if (day) expect(sky[2]).toBeGreaterThan(sky[0]!)
  else expect(sky[0]).toBeGreaterThan(sky[2]!)
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
