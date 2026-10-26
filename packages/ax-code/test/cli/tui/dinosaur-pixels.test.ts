import { expect, test } from "vitest"
import { renderDinosaurPixels } from "../../../src/cli/tui/component/dinosaur-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]
// Foreground band the baby dinosaur walks through, below the drifting pollen.
const WALKER_BAND = { x0: 40, x1: 200, y0: 420, y1: HEIGHT } as const
const walkerBand = (frame: Buffer) => {
  const rows: Buffer[] = []
  for (let y = WALKER_BAND.y0; y < WALKER_BAND.y1; y++)
    rows.push(frame.subarray((y * WIDTH + WALKER_BAND.x0) * 3, (y * WIDTH + WALKER_BAND.x1) * 3))
  return Buffer.concat(rows)
}

test.each(["dinosaur-day", "dinosaur-night"] as const)("%s paints deterministically from elapsed time", (style) => {
  const first = renderDinosaurPixels(WIDTH, HEIGHT, style, 0)
  const moving = renderDinosaurPixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(moving.equals(renderDinosaurPixels(WIDTH, HEIGHT, style, 900))).toBe(true)
  // The baby dinosaur arrives on the action envelope and holds its end pose, so
  // the walker's band stops changing while the valley keeps breathing.
  const arrived = walkerBand(renderDinosaurPixels(WIDTH, HEIGHT, style, 1900))
  expect(walkerBand(renderDinosaurPixels(WIDTH, HEIGHT, style, 2500))).toEqual(arrived)
  expect(walkerBand(renderDinosaurPixels(WIDTH, HEIGHT, style, 3600))).toEqual(arrived)
  // No wrap: the frame at the old cycle boundary is no longer the opening frame.
  expect(renderDinosaurPixels(WIDTH, HEIGHT, style, 3600).equals(first)).toBe(false)
  expect(renderDinosaurPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  expect(moving.equals(first)).toBe(false)
  // The distant hill never moves, and it is not sky.
  expect(pixel(moving, 500, 320)).toEqual(pixel(first, 500, 320))
  expect(pixel(first, 500, 320)).not.toEqual(pixel(first, 500, 0))
})

test.each(["dinosaur-day", "dinosaur-night"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderDinosaurPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})

test("moonlight separates the dinosaur from the valley without turning the whole night into day", () => {
  const night = renderDinosaurPixels(WIDTH, HEIGHT, "dinosaur-night", 900)
  const day = renderDinosaurPixels(WIDTH, HEIGHT, "dinosaur-day", 900)
  const luma = (rgb: number[]) => rgb[0]! * 0.299 + rgb[1]! * 0.587 + rgb[2]! * 0.114
  const body = luma(pixel(night, 250, 280))
  const valley = luma(pixel(night, 450, 280))
  expect(body - valley).toBeGreaterThan(25)
  expect(luma(pixel(night, 400, 40))).toBeLessThan(luma(pixel(day, 400, 40)) * 0.4)
})
