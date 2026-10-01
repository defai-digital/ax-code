import { expect, test } from "vitest"
import {
  DOMES_COLUMNS,
  DOMES_ROWS,
  domesBackground,
  domesFlakes,
  domesFlakesBig,
  domesGlint,
  domesRows,
} from "../../../src/cli/tui/component/domes-view-model"

test.each(["domes-snow", "domes-clear"] as const)("%s clips its domes to resized screens", (style) => {
  expect([DOMES_COLUMNS, DOMES_ROWS]).toEqual([76, 24])
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [12, 5],
    [36, 20],
    [80, 30],
    [120, 40],
  ]) {
    for (const elapsed of [0, 450, 900]) {
      const rows = domesRows(width!, height!, style, elapsed)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  }
  expect(domesBackground("domes-snow")).not.toBe(domesBackground("domes-clear"))
})

test("snowfall drifts while clear skies hold still", () => {
  const first = domesFlakes(0)
  expect(first).toHaveLength(24)
  expect(domesFlakes(0)).toEqual(first)
  expect(domesFlakes(450)).not.toEqual(first)
  expect(domesFlakes(-100)).toEqual(first)
  expect(domesRows(76, 24, "domes-snow", 0)).toEqual(domesRows(76, 24, "domes-snow", 0))
  expect(domesRows(76, 24, "domes-snow", 450)).not.toEqual(domesRows(76, 24, "domes-snow", 0))
  expect(domesRows(76, 24, "domes-clear", 450)).toEqual(domesRows(76, 24, "domes-clear", 0))
})

test("three crosses crown the bulging domes", () => {
  const rows = domesRows(76, 24, "domes-snow", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(5)[22]).toBe("+")
  expect(line(3)[38]).toBe("+")
  expect(line(5)[54]).toBe("+")
})

test("crosses glint over drums, doors, pines, and fences", () => {
  expect(domesGlint(0, 0)).toBe(true)
  expect(domesGlint(0, 1)).toBe(false)
  expect(domesGlint(900, 2)).toBe(true)
  const rows = domesRows(76, 24, "domes-snow", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(5)[21]).toBe("*")
  expect(line(11).slice(36, 41)).toBe("=====")
  expect(line(17).slice(37, 39)).toBe("||")
  expect(line(16).slice(3, 7)).toBe("/\\/\\")
  expect(line(18)).toContain("|")
})

test("a bell arch, chimney, woodpile, footprints, and big flakes dress the church", () => {
  expect(domesFlakesBig(0)).toHaveLength(8)
  expect(domesFlakesBig(0)[1]).toEqual({ x: 46, y: 5 })
  expect(domesFlakesBig(500)).not.toEqual(domesFlakesBig(0))
  const clear = domesRows(76, 24, "domes-clear", 0)
  const snow = domesRows(76, 24, "domes-snow", 0)
  const line = (rows: typeof clear, row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(clear, 8)[61]).toBe("o")
  expect(line(clear, 14).slice(8, 12)).toBe("|o |")
  expect(line(clear, 17).slice(8, 11)).toBe("[=]")
  expect(line(clear, 20)[38]).toBe(".")
  expect(line(snow, 5)[46]).toBe("o")
})
