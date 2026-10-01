import { expect, test } from "vitest"
import {
  SAGRADA_COLUMNS,
  SAGRADA_ROWS,
  sagradaBackground,
  sagradaDoves,
  sagradaHook,
  sagradaLightX,
  sagradaRows,
} from "../../../src/cli/tui/component/sagrada-view-model"

test.each(["sagrada-day", "sagrada-night"] as const)("%s clips its spires to resized screens", (style) => {
  expect([SAGRADA_COLUMNS, SAGRADA_ROWS]).toEqual([76, 24])
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [12, 5],
    [36, 20],
    [80, 30],
    [120, 40],
  ]) {
    for (const elapsed of [0, 450, 900]) {
      const rows = sagradaRows(width!, height!, style, elapsed)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  }
  expect(sagradaBackground("sagrada-day")).not.toBe(sagradaBackground("sagrada-night"))
})

test("the light band sweeps the facade on a 2400ms round", () => {
  expect(sagradaLightX(0)).toBe(0)
  expect(sagradaLightX(100)).toBe(1)
  expect(sagradaLightX(2400)).toBe(0)
  expect(sagradaLightX(-100)).toBe(0)
})

test.each(["sagrada-day", "sagrada-night"] as const)("%s renders deterministically", (style) => {
  expect(sagradaRows(76, 24, style, 0)).toEqual(sagradaRows(76, 24, style, 0))
  expect(sagradaRows(76, 24, style, 450)).not.toEqual(sagradaRows(76, 24, style, 0))
  const text = sagradaRows(76, 24, style, 0)
    .map((row) => row.map((run) => run.text).join(""))
    .join("\n")
  expect(text).toContain("|")
  expect(text).toContain("()")
})

test("night windows glow while day windows stay glass", () => {
  const day = sagradaRows(76, 24, "sagrada-day", 0)
  const night = sagradaRows(76, 24, "sagrada-night", 0)
  expect(day.flat().some((run) => run.color === "#4a9ac3")).toBe(true)
  expect(night.flat().some((run) => run.color === "#ffe14e")).toBe(true)
})

test("a rose blooms while the crane hook sways", () => {
  expect(sagradaHook(0)).toBe(0)
  expect(sagradaHook(300)).toBe(1)
  const rows = sagradaRows(76, 24, "sagrada-day", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(11).slice(36, 41)).toBe("oOOOo")
  expect(line(4)).toContain("-")
  expect(line(16).slice(10, 12)).toBe("||")
})

test("doves, visitors, light pools, flowers, and a load dress the temple", () => {
  expect(sagradaDoves(0)).toEqual([
    { x: 5, y: 3 },
    { x: 24, y: 4 },
    { x: 43, y: 3 },
    { x: 62, y: 4 },
  ])
  const rows = sagradaRows(76, 24, "sagrada-day", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(3)[5]).toBe("v")
  expect(line(10).slice(67, 69)).toBe("[]")
  expect(line(18)[20]).toBe("|")
  expect(line(20).slice(28, 33)).toBe("~~~~~")
  expect(line(22)[4]).toBe("@")
})
