import { expect, test } from "vitest"
import {
  BOROBUDUR_COLUMNS,
  BOROBUDUR_ROWS,
  borobudurBackground,
  borobudurBirds,
  borobudurDrift,
  borobudurRows,
} from "../../../src/cli/tui/component/borobudur-view-model"

test.each(["borobudur-mist", "borobudur-noon"] as const)("%s clips its terraces to resized screens", (style) => {
  expect([BOROBUDUR_COLUMNS, BOROBUDUR_ROWS]).toEqual([76, 24])
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [12, 5],
    [36, 20],
    [80, 30],
    [120, 40],
  ]) {
    for (const elapsed of [0, 450, 900]) {
      const rows = borobudurRows(width!, height!, style, elapsed)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  }
  expect(borobudurBackground("borobudur-mist")).not.toBe(borobudurBackground("borobudur-noon"))
})

test("mist drifts on a 4800ms round", () => {
  expect(borobudurDrift(0)).toBe(0)
  expect(borobudurDrift(200)).toBe(1)
  expect(borobudurDrift(4800)).toBe(0)
  expect(borobudurDrift(-100)).toBe(0)
})

test("the long-running westbound swift wraps without leaving a negative column", () => {
  expect(borobudurBirds(54800)[1]).toEqual({ x: 75, y: 4 })
})

test.each(["borobudur-mist", "borobudur-noon"] as const)("%s renders deterministically", (style) => {
  expect(borobudurRows(76, 24, style, 0)).toEqual(borobudurRows(76, 24, style, 0))
  expect(borobudurRows(76, 24, style, 450)).not.toEqual(borobudurRows(76, 24, style, 0))
  const text = borobudurRows(76, 24, style, 0)
    .map((row) => row.map((run) => run.text).join(""))
    .join("\n")
  expect(text).toContain("[")
  expect(text).toContain("n")
})

test("mist veils the tiers and thins to a wisp at noon", () => {
  const mist = borobudurRows(76, 24, "borobudur-mist", 0)
  const noon = borobudurRows(76, 24, "borobudur-noon", 0)
  const line = (rows: typeof mist, row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(mist, 6)).toContain("~")
  expect(line(noon, 6)).not.toContain("~")
  expect(line(noon, 10)).toContain("~")
})

test("a buddha, frieze, palms, and swifts fill the terraces", () => {
  expect(borobudurBirds(0)).toEqual([
    { x: 10, y: 6 },
    { x: 60, y: 4 },
  ])
  expect(borobudurBirds(300)[0]).toEqual({ x: 11, y: 6 })
  expect(borobudurBirds(400)[1]).toEqual({ x: 59, y: 4 })
  const mist = borobudurRows(76, 24, "borobudur-mist", 0)
  const noon = borobudurRows(76, 24, "borobudur-noon", 0)
  const line = (rows: typeof mist, row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(mist, 4)[38]).toBe("&")
  expect(line(mist, 6)[10]).toBe("v")
  expect(line(noon, 14)[16]).toBe("o")
  expect(line(noon, 13)[7]).toBe("|")
})

test("a volcano, sun, pilgrims, offerings, and deeper jungle fill the valley", () => {
  const mist = borobudurRows(76, 24, "borobudur-mist", 0)
  const noon = borobudurRows(76, 24, "borobudur-noon", 0)
  const line = (rows: typeof mist, row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(mist, 2).slice(62, 67)).toBe("(   )")
  expect(line(mist, 7)[33]).toBe("*")
  expect(line(noon, 9).slice(5, 7)).toBe("/\\")
  expect(line(noon, 12)[20]).toBe("o")
  expect(line(noon, 16)[8]).toBe("/")
})
