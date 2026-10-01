import { expect, test } from "vitest"
import {
  FALLS_COLUMNS,
  FALLS_ROWS,
  fallsBackground,
  fallsFireflies,
  fallsMist,
  fallsRows,
  fallsTick,
} from "../../../src/cli/tui/component/falls-view-model"

test.each(["falls-day", "falls-moon"] as const)("%s clips its falls to resized screens", (style) => {
  expect([FALLS_COLUMNS, FALLS_ROWS]).toEqual([76, 24])
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [12, 5],
    [36, 20],
    [80, 30],
    [120, 40],
  ]) {
    for (const elapsed of [0, 450, 900]) {
      const rows = fallsRows(width!, height!, style, elapsed)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  }
  expect(fallsBackground("falls-day")).not.toBe(fallsBackground("falls-moon"))
})

test("mist and fireflies drift deterministically past the falls", () => {
  const mist = fallsMist(0)
  expect(mist).toHaveLength(8)
  expect(fallsMist(0)).toEqual(mist)
  expect(fallsMist(1200)).not.toEqual(mist)
  expect(fallsMist(2400)).toEqual(mist)
  expect(fallsMist(-100)).toEqual(mist)
  const flies = fallsFireflies(0)
  expect(flies).toHaveLength(6)
  expect(fallsFireflies(0)).toEqual(flies)
  expect(fallsFireflies(1200)).not.toEqual(flies)
  expect(fallsFireflies(2400)).toEqual(flies)
  expect(fallsFireflies(-100)).toEqual(flies)
})

test.each(["falls-day", "falls-moon"] as const)("%s renders deterministically", (style) => {
  expect(fallsRows(76, 24, style, 0)).toEqual(fallsRows(76, 24, style, 0))
  expect(fallsRows(76, 24, style, 450)).not.toEqual(fallsRows(76, 24, style, 0))
  expect(fallsRows(76, 24, style, 2400)).toEqual(fallsRows(76, 24, style, 0))
  expect(fallsRows(76, 24, style, -100)).toEqual(fallsRows(76, 24, style, 0))
  const text = fallsRows(76, 24, style, 0)
    .map((row) => row.map((run) => run.text).join(""))
    .join("\n")
  expect(text).toContain("~~~")
  expect(text).toContain("#")
})

test("water falls between twin cliffs into a pool", () => {
  expect(fallsTick(0)).toBe(0)
  expect(fallsTick(200)).toBe(1)
  const rows = fallsRows(76, 24, "falls-day", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(10).slice(32, 44)).toBe("||||||||||||")
  expect(line(10)[8]).toBe("#")
  expect(line(10)[60]).toBe("#")
  expect(line(18)).toContain("~~~")
})

test("a rainbow arcs by day and fireflies glow by moonlight", () => {
  const day = fallsRows(76, 24, "falls-day", 0)
  const dayLine = (row: number) => day[row]!.map((run) => run.text).join("")
  expect(dayLine(14)[47]).toBe("(")
  expect(dayLine(14)[55]).toBe(")")
  const night = fallsRows(76, 24, "falls-moon", 0)
  const nightLine = (row: number) => night[row]!.map((run) => run.text).join("")
  expect(nightLine(2)).toContain("(   )")
  expect(nightLine(14)[47]).not.toBe("(")
})
