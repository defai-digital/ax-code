import { expect, test } from "vitest"
import {
  CITY_COLUMNS,
  CITY_ROWS,
  cityBackground,
  cityBuildings,
  cityRows,
  cityWindowLit,
  cityWindows,
} from "../../../src/cli/tui/component/city-view-model"

test.each(["city-night", "city-dawn"] as const)("%s clips its skyline to resized screens", (style) => {
  expect([CITY_COLUMNS, CITY_ROWS]).toEqual([72, 24])
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [12, 5],
    [36, 20],
    [80, 30],
    [120, 40],
  ]) {
    for (const elapsed of [0, 600, 1500]) {
      const rows = cityRows(width!, height!, style, elapsed)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  }
  expect(cityBackground("city-night")).not.toBe(cityBackground("city-dawn"))
})

test("building layout fits the reference exactly once", () => {
  const buildings = cityBuildings()
  expect(buildings).toHaveLength(9)
  let edge = 0
  for (const building of buildings) {
    expect(building.x).toBeGreaterThanOrEqual(edge)
    expect(building.x + building.w).toBeLessThanOrEqual(CITY_COLUMNS)
    expect(building.top).toBeGreaterThanOrEqual(0)
    edge = building.x + building.w + 1
    for (const window of cityWindows(building)) {
      expect(window.x).toBeGreaterThanOrEqual(building.x)
      expect(window.x).toBeLessThan(building.x + building.w)
      expect(window.y).toBeGreaterThanOrEqual(building.top)
      expect(window.y).toBeLessThan(22)
    }
  }
})

test("windows twinkle with the shared phase", () => {
  expect(cityWindowLit("city-night", 0, 0, 0, 0)).toBe(true)
  expect(cityWindowLit("city-night", 0, 0, 0, 600)).toBe(false)
  expect(cityWindowLit("city-dawn", 0, 0, 0, 0)).toBe(true)
  expect(cityWindowLit("city-dawn", 0, 0, 0, 600)).toBe(false)
  // Non-twinkle windows hold their hash across time.
  expect(cityWindowLit("city-night", 0, 1, 0, 0)).toBe(cityWindowLit("city-night", 0, 1, 0, 600))
})

test.each(["city-night", "city-dawn"] as const)("%s renders its skyline deterministically", (style) => {
  const first = cityRows(72, 24, style, 0)
  expect(cityRows(72, 24, style, 0)).toEqual(first)
  expect(cityRows(72, 24, style, 600)).not.toEqual(first)
  const text = first.map((row) => row.map((run) => run.text).join("")).join("\n")
  expect(text).toContain("(   )")
  // Building zero window (0,0) flips with the twinkle phase.
  expect(first[14]!.map((run) => run.text).join("")[2]).toBe("*")
  expect(
    cityRows(72, 24, style, 600)[14]!
      .map((run) => run.text)
      .join("")[2],
  ).toBe(".")
  // Street lamps burn on row 22.
  expect(first[22]!.map((run) => run.text).join("")).toContain("*")
})

test("night and dawn keep distinct skies", () => {
  const night = cityRows(72, 24, "city-night", 0)
  const dawn = cityRows(72, 24, "city-dawn", 0)
  expect(night[0]!.map((run) => run.text).join("")).toContain("*")
  expect(
    dawn[0]!
      .map((run) => run.text)
      .join("")
      .trim(),
  ).toBe("")
  expect(night.flat().some((run) => run.color === "#ffd166")).toBe(true)
  expect(dawn.flat().some((run) => run.color === "#ffe6a3")).toBe(true)
})
