import { expect, test } from "vitest"
import {
  CORCOVADO_COLUMNS,
  CORCOVADO_ROWS,
  corcovadoBackground,
  corcovadoCable,
  corcovadoClouds,
  corcovadoGliders,
  corcovadoGulls,
  corcovadoRows,
  corcovadoSail,
  corcovadoSurf,
} from "../../../src/cli/tui/component/corcovado-view-model"

test.each(["corcovado-day", "corcovado-gold"] as const)("%s clips its peak to resized screens", (style) => {
  expect([CORCOVADO_COLUMNS, CORCOVADO_ROWS]).toEqual([76, 24])
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [12, 5],
    [36, 20],
    [80, 30],
    [120, 40],
  ]) {
    for (const elapsed of [0, 450, 900]) {
      const rows = corcovadoRows(width!, height!, style, elapsed)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  }
  expect(corcovadoBackground("corcovado-day")).not.toBe(corcovadoBackground("corcovado-gold"))
})

test("clouds swirl around the peak on a shared round", () => {
  const first = corcovadoClouds(0)
  expect(first).toHaveLength(6)
  expect(corcovadoClouds(0)).toEqual(first)
  expect(corcovadoClouds(900)).not.toEqual(first)
  expect(corcovadoClouds(4800)).toEqual(first)
  expect(corcovadoClouds(-100)).toEqual(first)
})

test.each(["corcovado-day", "corcovado-gold"] as const)("%s renders deterministically", (style) => {
  expect(corcovadoRows(76, 24, style, 0)).toEqual(corcovadoRows(76, 24, style, 0))
  expect(corcovadoRows(76, 24, style, 450)).not.toEqual(corcovadoRows(76, 24, style, 0))
  const text = corcovadoRows(76, 24, style, 0)
    .map((row) => row.map((run) => run.text).join(""))
    .join("\n")
  expect(text).toContain("/")
  expect(text).toContain("~")
})

test("the statue opens its arms on the summit", () => {
  const rows = corcovadoRows(76, 24, "corcovado-day", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(2)[38]).toBe("o")
  expect(line(3).slice(33, 44)).toBe("_____|_____")
})

test("the bay breathes with surf, sail, and Sugarloaf", () => {
  expect(corcovadoSurf(0)).toBe(0)
  expect(corcovadoSurf(300)).toBe(1)
  expect(corcovadoSail(0)).toBe(-10)
  expect(corcovadoSail(9600)).toBe(-10)
  const rows = corcovadoRows(76, 24, "corcovado-day", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(18)).toContain(".")
  expect(rows.flat().some((run) => run.color === "#4a5a68")).toBe(true)
})

test("gliders, gulls, a cable car, and umbrellas fill the bay", () => {
  expect(corcovadoGliders(0)).toEqual([
    { x: 62, y: 7 },
    { x: 14, y: 7 },
  ])
  expect(corcovadoGulls(0)).toEqual([
    { x: 10, y: 5 },
    { x: 35, y: 6 },
    { x: 60, y: 5 },
  ])
  expect(corcovadoCable(0)).toBe(2)
  expect(corcovadoCable(200)).toBe(3)
  expect(corcovadoCable(2400)).toBe(2)
  const rows = corcovadoRows(76, 24, "corcovado-day", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(7)[62]).toBe("V")
  expect(line(5)[10]).toBe("v")
  expect(line(11).slice(2, 4)).toBe("[]")
  expect(line(20)[0]).toBe("~")
  expect(line(20)[4]).toBe("=")
  expect(line(21)[8]).toBe("|")
})
