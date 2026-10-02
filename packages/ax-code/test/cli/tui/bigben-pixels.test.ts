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
  expect(pixel(first, 0, 0)).toEqual(day ? [147, 202, 231] : [22, 26, 52])
  // Tower stone, the gilded dial ring, and the bridge never move.
  expect(pixel(moving, 350, 260)).toEqual(pixel(first, 350, 260))
  expect(pixel(first, 375, 160)).toEqual([222, 176, 70])
  expect(pixel(moving, 375, 160)).toEqual([222, 176, 70])
  expect(pixel(moving, 185, 390)).toEqual(pixel(first, 185, 390))
  // The Thames runs beneath the quay.
  expect(pixel(first, 100, 430)).not.toEqual(pixel(moving, 100, 430))
  // The bus nose enters from the left: red body at 900ms, bare sky or quay at 0.
  const [r, g] = pixel(moving, 30, 378)
  expect(r!).toBeGreaterThan(g! * 2)
  const [r0, g0] = pixel(first, 30, 378)
  expect(r0! > g0! * 2).toBe(false)
  if (!day) {
    // Lit tower windows glow warm against the dark stone.
    const [wr, , wb] = pixel(first, 375, 240)
    expect(wr!).toBeGreaterThan(wb!)
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
