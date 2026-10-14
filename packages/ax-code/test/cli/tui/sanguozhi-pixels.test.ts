import { expect, test } from "vitest"
import { renderSanguozhiPixels } from "../../../src/cli/tui/component/sanguozhi-pixels"
import { renderTextScenePixels } from "../../../src/cli/tui/component/text-scene-pixels"
import { sanguozhiRows } from "../../../src/cli/tui/component/sanguozhi-view-model"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["sanguozhi-muster", "sanguozhi-dusk"] as const)(
  "%s paints deterministically from elapsed time",
  (style) => {
    const first = renderSanguozhiPixels(WIDTH, HEIGHT, style, 0)
    const moving = renderSanguozhiPixels(WIDTH, HEIGHT, style, 900)
    expect(first.length).toBe(WIDTH * HEIGHT * 3)
    expect(moving.equals(renderSanguozhiPixels(WIDTH, HEIGHT, style, 900))).toBe(true)
    expect(renderSanguozhiPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
    // The gate tower wall never moves and reads as dark timber or stone.
    const tower = pixel(first, 380, 300)
    expect(pixel(moving, 380, 300)).toEqual(tower)
    expect(tower[0]! + tower[1]! + tower[2]!).toBeLessThan(420)
    // Banners, mist, or riders keep the scene moving between frames.
    expect(first.equals(moving)).toBe(false)
    // The scene dispatcher routes to this renderer.
    expect(
      renderTextScenePixels(WIDTH, HEIGHT, style, 700).equals(renderSanguozhiPixels(WIDTH, HEIGHT, style, 700)),
    ).toBe(true)
  },
)

test.each(["sanguozhi-muster", "sanguozhi-dusk"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderSanguozhiPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})

test.each(["sanguozhi-muster", "sanguozhi-dusk"] as const)("%s text rows fill the requested grid", (style) => {
  const rows = sanguozhiRows(100, 30, style, 1200)
  expect(rows.length).toBeGreaterThan(0)
  for (const row of rows) expect(row.map((run) => run.text).join("").length).toBeGreaterThan(0)
})
