import { expect, test } from "vitest"
import { renderSanguozhiPixels, sanguozhiDate, sanguozhiFlipAt } from "../../../src/cli/tui/component/sanguozhi-pixels"
import { renderTextScenePixels } from "../../../src/cli/tui/component/text-scene-pixels"
import { sanguozhiRows } from "../../../src/cli/tui/component/sanguozhi-view-model"
import {
  SANGUOZHI_CITIES,
  SANGUOZHI_GLYPH_CHARS,
  SANGUOZHI_ROADS,
  insideSea,
} from "../../../src/cli/tui/component/sanguozhi-map"
import { SANGUOZHI_GLYPHS } from "../../../src/cli/tui/component/sanguozhi-glyphs"

const WIDTH = 640
const HEIGHT = 360

test.each(["sanguozhi-muster", "sanguozhi-dusk"] as const)("%s paints deterministically from elapsed time", (style) => {
  const first = renderSanguozhiPixels(WIDTH, HEIGHT, style, 0)
  const moving = renderSanguozhiPixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(moving.equals(renderSanguozhiPixels(WIDTH, HEIGHT, style, 900))).toBe(true)
  expect(renderSanguozhiPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  // Armies, clouds, banners, or lamps keep the map moving between frames.
  expect(first.equals(moving)).toBe(false)
  // The scene dispatcher routes to this renderer.
  expect(
    renderTextScenePixels(WIDTH, HEIGHT, style, 700).equals(renderSanguozhiPixels(WIDTH, HEIGHT, style, 700)),
  ).toBe(true)
})

test("the opening map shows land, sea, and a bright morning; the ending is darker", () => {
  const morning = renderSanguozhiPixels(WIDTH, HEIGHT, "sanguozhi-muster", 1500)
  const dusk = renderSanguozhiPixels(WIDTH, HEIGHT, "sanguozhi-dusk", 1500)
  const mean = (frame: Buffer) => frame.reduce((sum, value) => sum + value, 0) / frame.length
  expect(mean(dusk)).toBeLessThan(mean(morning) * 0.85)
  // The east edge at mid-height is open sea: blue dominates.
  const sea = morning.subarray((HEIGHT * 0.45 * WIDTH + WIDTH - 4) * 3)
  expect(sea[2]!).toBeGreaterThan(sea[0]! + 40)
  expect(insideSea(122, 34)).toBe(true)
  expect(insideSea(112.4, 34.7)).toBe(false)
})

test("every road joins two known cities and every label glyph exists", () => {
  for (const [a, b] of SANGUOZHI_ROADS) {
    expect(SANGUOZHI_CITIES[a]).toBeDefined()
    expect(SANGUOZHI_CITIES[b]).toBeDefined()
    expect(a).not.toBe(b)
  }
  for (const char of SANGUOZHI_GLYPH_CHARS) expect(SANGUOZHI_GLYPHS[char]).toHaveLength(24 * 24)
  for (const city of SANGUOZHI_CITIES) for (const char of city.name) expect(SANGUOZHI_GLYPH_CHARS).toContain(char)
})

test("the ending turns every banner, spreading outward from Luoyang before the fade-out", () => {
  const luoyang = SANGUOZHI_CITIES.findIndex((city) => city.name === "洛陽")
  const times = SANGUOZHI_CITIES.map((_, index) => sanguozhiFlipAt(index))
  expect(Math.min(...times)).toBe(times[luoyang])
  expect(Math.max(...times)).toBeLessThan(2400)
  const chengdu = SANGUOZHI_CITIES.findIndex((city) => city.name === "成都")
  expect(times[chengdu]!).toBeGreaterThan(times[luoyang]!)
})

test("the date panel turns the months of 184 and holds 280 in the ending", () => {
  expect(sanguozhiDate("sanguozhi-muster", 0)).toEqual({ year: 184, month: 1 })
  expect(sanguozhiDate("sanguozhi-muster", 1500).month).toBe(3)
  expect(sanguozhiDate("sanguozhi-muster", 1e9).month).toBeGreaterThanOrEqual(1)
  expect(sanguozhiDate("sanguozhi-muster", 1e9).month).toBeLessThanOrEqual(12)
  expect(sanguozhiDate("sanguozhi-dusk", 2000)).toEqual({ year: 280, month: 3 })
})

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
