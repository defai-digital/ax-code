import { expect, test } from "vitest"
import { renderDungeonPixels } from "../../../src/cli/tui/component/dungeon-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["dungeon-descent", "dungeon-treasure"] as const)(
  "%s paints deterministically from elapsed time",
  (style) => {
    const descent = style === "dungeon-descent"
    const first = renderDungeonPixels(WIDTH, HEIGHT, style, 0)
    const moving = renderDungeonPixels(WIDTH, HEIGHT, style, 900)
    expect(first.length).toBe(WIDTH * HEIGHT * 3)
    expect(first.equals(moving)).toBe(false)
    expect(renderDungeonPixels(WIDTH, HEIGHT, style, 900).equals(moving)).toBe(true)
    expect(renderDungeonPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
    expect(renderDungeonPixels(WIDTH, HEIGHT, style, 2400).equals(first)).toBe(true)
    // Light falls off from the torches: the wall beside one is brighter than the far corner.
    const lum = (p: number[]) => p[0]! + p[1]! + p[2]!
    expect(lum(pixel(first, 120, 190))).toBeGreaterThan(lum(pixel(first, 30, 300)))
    // The torch flame itself is bright.
    expect(lum(pixel(first, 105, 170))).toBeGreaterThan(300)
    // The vault wall is lit warm (red over blue).
    const wall = pixel(first, 380, 120)
    if (!descent) expect(wall[0]!).toBeGreaterThan(wall[2]!)
  },
)

test.each(["dungeon-descent", "dungeon-treasure"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderDungeonPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})
