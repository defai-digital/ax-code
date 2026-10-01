import { expect, test } from "vitest"
import {
  TAIPEI101_COLUMNS,
  TAIPEI101_ROWS,
  taipei101Background,
  taipei101Beacon,
  taipei101Cars,
  taipei101Clouds,
  taipei101Lanterns,
  taipei101Lit,
  taipei101Rows,
  taipei101Train,
} from "../../../src/cli/tui/component/taipei101-view-model"

test.each(["taipei101-day", "taipei101-neon"] as const)("%s clips its tiers to resized screens", (style) => {
  expect([TAIPEI101_COLUMNS, TAIPEI101_ROWS]).toEqual([76, 24])
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [12, 5],
    [36, 20],
    [80, 30],
    [120, 40],
  ]) {
    for (const elapsed of [0, 450, 900]) {
      const rows = taipei101Rows(width!, height!, style, elapsed)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  }
  expect(taipei101Background("taipei101-day")).not.toBe(taipei101Background("taipei101-neon"))
})

test("windows chase on a shared round", () => {
  expect(taipei101Lit(0, 0)).toBe(true)
  expect(taipei101Lit(0, 1)).toBe(false)
  expect(taipei101Lit(400, 1)).toBe(false)
  expect(taipei101Lit(400, 3)).toBe(true)
  expect(taipei101Lit(-100, 0)).toBe(true)
})

test("clouds wrap right after crossing the left edge and repeat on their full round", () => {
  expect(taipei101Clouds(1200)[0]).toEqual({ x: 87, y: 3 })
  expect(taipei101Clouds(17600)).toEqual(taipei101Clouds(0))
})

test.each(["taipei101-day", "taipei101-neon"] as const)("%s renders deterministically", (style) => {
  expect(taipei101Rows(76, 24, style, 0)).toEqual(taipei101Rows(76, 24, style, 0))
  expect(taipei101Rows(76, 24, style, 450)).not.toEqual(taipei101Rows(76, 24, style, 0))
  const text = taipei101Rows(76, 24, style, 0)
    .map((row) => row.map((run) => run.text).join(""))
    .join("\n")
  expect(text).toContain("[")
  expect(text).toContain("]")
})

test("neon frames the tiers in pink while day stays steel", () => {
  const day = taipei101Rows(76, 24, "taipei101-day", 0)
  const neon = taipei101Rows(76, 24, "taipei101-neon", 0)
  expect(day.flat().some((run) => run.color === "#3d5a73")).toBe(true)
  expect(neon.flat().some((run) => run.color === "#ff5ad0")).toBe(true)
  expect(day).not.toEqual(neon)
})

test("the beacon blinks over street traffic and a lit podium", () => {
  expect(taipei101Beacon(0)).toBe(true)
  expect(taipei101Beacon(600)).toBe(false)
  const cars = taipei101Cars(0)
  expect(cars).toHaveLength(2)
  expect(taipei101Cars(450)).not.toEqual(cars)
  const rows = taipei101Rows(76, 24, "taipei101-day", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(1)[37]).toBe("*")
  expect(line(19)).toContain("-")
  expect(line(18)).toContain("[  ]")
})

test("a train runs behind the tower while lanterns rise over gardens and parks", () => {
  expect(taipei101Train(0)).toBe(-12)
  expect(taipei101Train(800)).toBe(8)
  expect(taipei101Lanterns(0)).toEqual([
    { x: 8, y: 16 },
    { x: 60, y: 11 },
    { x: 68, y: 6 },
  ])
  const rows = taipei101Rows(76, 24, "taipei101-day", 0)
  const late = taipei101Rows(76, 24, "taipei101-day", 800)
  const line = (grid: typeof rows, row: number) => grid[row]!.map((run) => run.text).join("")
  expect(line(rows, 14)[22]).toBe("|")
  expect(line(rows, 16).slice(23, 25)).toBe("^^")
  expect(line(rows, 6)[68]).toBe("o")
  expect(line(rows, 22).slice(8, 10)).toBe("||")
  expect(line(rows, 21)[19]).toBe("*")
  expect(line(late, 12).slice(8, 14)).toBe("[====]")
})
