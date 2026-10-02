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
  // The brick rampart and the hillside never move.
  expect(pixel(moving, 50, 300)).toEqual(pixel(first, 50, 300))
  expect(pixel(moving, 600, 440)).toEqual(pixel(first, 600, 440))
  // Brick is warm (red over blue); dawn light lifts it above the dusk rampart.
  const brick = pixel(first, 50, 300)
  expect(brick[0]!).toBeGreaterThan(brick[2]!)
  // Dusk skies are warmer than dawn skies at the same spot.
  const sky = pixel(first, 380, 40)
  if (!dawn) expect(sky[0]!).toBeGreaterThan(sky[2]!)
  else expect(sky[2]!).toBeGreaterThanOrEqual(sky[0]! - 40)
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
