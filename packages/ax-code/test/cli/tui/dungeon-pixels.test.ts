import { expect, test } from "vitest"
import { renderDungeonPixels } from "../../../src/cli/tui/component/dungeon-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["dungeon-descent", "dungeon-treasure"] as const)("%s paints deterministically from elapsed time", (style) => {
  const descent = style === "dungeon-descent"
  const first = renderDungeonPixels(WIDTH, HEIGHT, style, 0)
  const moving = renderDungeonPixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(first.equals(moving)).toBe(false)
  expect(renderDungeonPixels(WIDTH, HEIGHT, style, 900).equals(moving)).toBe(true)
  expect(renderDungeonPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  expect(renderDungeonPixels(WIDTH, HEIGHT, style, 2400).equals(first)).toBe(true)
  // The ceiling never moves.
  expect(pixel(first, 0, 0)).toEqual(descent ? [58, 58, 74] : [74, 66, 58])
  // The first tread and the chest lid never move.
  const anchor: readonly [number, number, number] = descent ? [110, 110, 126] : [232, 200, 74]
  const at = descent ? ([65, 90] as const) : ([380, 330] as const)
  expect(pixel(first, at[0], at[1])).toEqual(anchor)
  expect(pixel(moving, at[0], at[1])).toEqual(anchor)
})

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
