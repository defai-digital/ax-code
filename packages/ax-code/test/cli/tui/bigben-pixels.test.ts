import { expect, test } from "vitest"
import { renderBigbenPixels } from "../../../src/cli/tui/component/bigben-pixels"
import { renderTextScenePixels } from "../../../src/cli/tui/component/text-scene-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["bigben-day", "bigben-night"] as const)("%s paints the tower from elapsed time", (style) => {
  const day = style === "bigben-day"
  const first = renderBigbenPixels(WIDTH, HEIGHT, style, 0)
  const moving = renderBigbenPixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(first.equals(moving)).toBe(false)
  expect(renderBigbenPixels(WIDTH, HEIGHT, style, 900).equals(moving)).toBe(true)
  expect(renderBigbenPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  expect(pixel(first, 0, 0)).toEqual(day ? [142, 200, 232] : [10, 16, 48])
  // Tower stone between the string courses never moves.
  const stone: readonly [number, number, number] = day ? [201, 191, 168] : [74, 74, 98]
  expect(pixel(first, 350, 260)).toEqual(stone)
  expect(pixel(moving, 350, 260)).toEqual(stone)
  // The quay stays put while the Thames runs beneath it.
  const ground: readonly [number, number, number] = day ? [90, 122, 74] : [26, 42, 26]
  expect(pixel(first, 130, 410)).toEqual(ground)
  const water: readonly [number, number, number] = day ? [51, 112, 142] : [17, 35, 67]
  expect(pixel(first, 100, 430)).toEqual(water)
  // A bridge arch foot never moves.
  const bridge: readonly [number, number, number] = day ? [138, 130, 114] : [44, 44, 64]
  expect(pixel(first, 185, 390)).toEqual(bridge)
  expect(pixel(moving, 185, 390)).toEqual(bridge)
  // The bus nose enters from the left.
  const bus: readonly [number, number, number] = day ? [184, 58, 58] : [122, 42, 42]
  expect(pixel(moving, 30, 350)).toEqual(bus)
  if (!day) {
    // The floodlight raking the tower.
    expect(pixel(first, 325, 350)).toEqual([255, 233, 168])
    expect(pixel(moving, 325, 350)).toEqual([255, 233, 168])
  }
  // The scene dispatcher routes to this renderer.
  expect(renderTextScenePixels(WIDTH, HEIGHT, style, 700).equals(renderBigbenPixels(WIDTH, HEIGHT, style, 700))).toBe(
    true,
  )
})

test.each(["bigben-day", "bigben-night"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderBigbenPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})
