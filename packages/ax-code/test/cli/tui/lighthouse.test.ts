import { expect, test } from "vitest"
import {
  LIGHTHOUSE_COLUMNS,
  LIGHTHOUSE_ROWS,
  lighthouseBackground,
  lighthouseBeam,
  lighthouseGulls,
  lighthouseRows,
  lighthouseSurf,
} from "../../../src/cli/tui/component/lighthouse-view-model"

test.each(["lighthouse-day", "lighthouse-night"] as const)("%s clips its tower to resized screens", (style) => {
  expect([LIGHTHOUSE_COLUMNS, LIGHTHOUSE_ROWS]).toEqual([76, 24])
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [12, 5],
    [36, 20],
    [80, 30],
    [120, 40],
  ]) {
    for (const elapsed of [0, 450, 900]) {
      const rows = lighthouseRows(width!, height!, style, elapsed)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  }
  expect(lighthouseBackground("lighthouse-day")).not.toBe(lighthouseBackground("lighthouse-night"))
})

test("gulls glide deterministically past the tower", () => {
  const first = lighthouseGulls(0)
  expect(first).toHaveLength(4)
  expect(lighthouseGulls(0)).toEqual(first)
  expect(lighthouseGulls(1200)).not.toEqual(first)
  expect(lighthouseGulls(2400)).toEqual(first)
  expect(lighthouseGulls(-100)).toEqual(first)
})

test("the beam rotates once per cycle while surf rolls shoreward", () => {
  expect(lighthouseBeam(0)).toBe(0)
  expect(lighthouseBeam(600)).toBe(1)
  expect(lighthouseBeam(1200)).toBe(2)
  expect(lighthouseBeam(1800)).toBe(3)
  expect(lighthouseBeam(2400)).toBe(0)
  expect(lighthouseSurf(0)).toBe(0)
  expect(lighthouseSurf(2400)).toBe(0)
  expect(lighthouseSurf(-50)).toBe(0)
})

test.each(["lighthouse-day", "lighthouse-night"] as const)("%s renders deterministically", (style) => {
  expect(lighthouseRows(76, 24, style, 0)).toEqual(lighthouseRows(76, 24, style, 0))
  expect(lighthouseRows(76, 24, style, 450)).not.toEqual(lighthouseRows(76, 24, style, 0))
  expect(lighthouseRows(76, 24, style, 2400)).toEqual(lighthouseRows(76, 24, style, 0))
  const text = lighthouseRows(76, 24, style, 0)
    .map((row) => row.map((run) => run.text).join(""))
    .join("\n")
  expect(text).toContain("||||")
  expect(text).toContain("~~")
})

test("stripes, gallery, cliffs, and foam anchor the day scene", () => {
  const rows = lighthouseRows(76, 24, "lighthouse-day", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(5).slice(11, 15)).toBe("||||")
  expect(line(3).slice(11, 15)).toBe("[  ]")
  expect(line(16).slice(8, 11)).toBe("###")
  expect(line(19).slice(0, 2)).toBe("~~")
})

test("the beam sweeps east from the lit lamp room at night", () => {
  const rows = lighthouseRows(76, 24, "lighthouse-night", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(3).slice(11, 14)).toBe("[**")
  expect(line(3).slice(14, 34)).toBe("=".repeat(20))
})
