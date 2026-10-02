import { expect, test } from "vitest"
import { renderAuroraPixels } from "../../../src/cli/tui/component/aurora-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["aurora-night", "aurora-dawn"] as const)("%s paints deterministically from elapsed time", (style) => {
  const night = style === "aurora-night"
  const first = renderAuroraPixels(WIDTH, HEIGHT, style, 0)
  const moving = renderAuroraPixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(first.equals(moving)).toBe(false)
  expect(moving.equals(renderAuroraPixels(WIDTH, HEIGHT, style, 900))).toBe(true)
  expect(renderAuroraPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  // The sky keeps the shared backdrop above the curtains.
  expect(pixel(first, 0, 0)).toEqual(night ? [10, 18, 48] : [58, 74, 110])
  // The curtains sway: a pixel inside a curtain changes between frames.
  expect(pixel(first, 305, 100)).not.toEqual(pixel(moving, 305, 100))
  // Far shoreline stays put while the sky and lake shimmer.
  expect(pixel(first, 5, 300)).toEqual(pixel(moving, 5, 300))
  expect(pixel(first, 380, 260)).toEqual(pixel(moving, 380, 260))
})

test.each(["aurora-night", "aurora-dawn"] as const)("%s mirrors the sky in the lake", (style) => {
  const first = renderAuroraPixels(WIDTH, HEIGHT, style, 0)
  const later = renderAuroraPixels(WIDTH, HEIGHT, style, 900)
  let changed = 0
  for (let y = 370; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x += 4) {
      const i = (y * WIDTH + x) * 3
      if (first[i] !== later[i] || first[i + 1] !== later[i + 1] || first[i + 2] !== later[i + 2]) changed++
    }
  }
  expect(changed).toBeGreaterThan(200)
})

test.each(["aurora-night", "aurora-dawn"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderAuroraPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})
