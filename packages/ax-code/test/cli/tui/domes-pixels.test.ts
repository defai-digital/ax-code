import { expect, test } from "vitest"
import { renderDomesPixels } from "../../../src/cli/tui/component/domes-pixels"
import { renderTextScenePixels } from "../../../src/cli/tui/component/text-scene-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test("domes-snow paints falling snow from elapsed time", () => {
  const first = renderDomesPixels(WIDTH, HEIGHT, "domes-snow", 0)
  const moving = renderDomesPixels(WIDTH, HEIGHT, "domes-snow", 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(first.equals(moving)).toBe(false)
  expect(renderDomesPixels(WIDTH, HEIGHT, "domes-snow", 900).equals(moving)).toBe(true)
  expect(renderDomesPixels(WIDTH, HEIGHT, "domes-snow", -100).equals(first)).toBe(true)
  // Plaster and the snowfield never move.
  expect(pixel(moving, 350, 300)).toEqual(pixel(first, 350, 300))
  expect(pixel(moving, 650, 470)).toEqual(pixel(first, 650, 470))
  // Snow ground is near white-blue; a lit window glows warm.
  const ground = pixel(first, 650, 470)
  expect(ground[2]!).toBeGreaterThan(ground[0]!)
  const pane = pixel(first, 205, 305)
  expect(pane[0]!).toBeGreaterThan(pane[2]! + 40)
})

test("domes-clear shows a blue dome over a green meadow and animates its sky", () => {
  const first = renderDomesPixels(WIDTH, HEIGHT, "domes-clear", 0)
  const moving = renderDomesPixels(WIDTH, HEIGHT, "domes-clear", 900)
  expect(moving.equals(renderDomesPixels(WIDTH, HEIGHT, "domes-clear", 900))).toBe(true)
  expect(moving.equals(first)).toBe(false)
  expect(pixel(moving, 350, 300)).toEqual(pixel(first, 350, 300))
  expect(pixel(moving, 650, 470)).toEqual(pixel(first, 650, 470))
  const dome = pixel(first, 385, 180)
  expect(dome[2]!).toBeGreaterThan(dome[0]!)
  const meadow = pixel(first, 650, 470)
  expect(meadow[1]!).toBeGreaterThan(meadow[2]!)
})

test("domes-clear keeps visible motion", () => {
  let best = 0
  let prev = renderDomesPixels(WIDTH, HEIGHT, "domes-clear", 0)
  for (let t = 100; t <= 3000; t += 100) {
    const frame = renderDomesPixels(WIDTH, HEIGHT, "domes-clear", t)
    let changed = 0
    for (let i = 0; i < frame.length; i += 3) {
      const d = Math.abs(
        0.299 * (frame[i]! - prev[i]!) +
          0.587 * (frame[i + 1]! - prev[i + 1]!) +
          0.114 * (frame[i + 2]! - prev[i + 2]!),
      )
      if (d > 8) changed++
    }
    best = Math.max(best, changed / (frame.length / 3))
    prev = frame
  }
  expect(best).toBeGreaterThan(0.015)
})

test.each(["domes-snow", "domes-clear"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderDomesPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
  // The scene dispatcher routes to this renderer.
  expect(renderTextScenePixels(WIDTH, HEIGHT, style, 700).equals(renderDomesPixels(WIDTH, HEIGHT, style, 700))).toBe(
    true,
  )
})
