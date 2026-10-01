import { expect, test } from "vitest"
import {
  EIFFEL_COLUMNS,
  EIFFEL_ROWS,
  eiffelBackground,
  eiffelBeacon,
  eiffelBeam,
  eiffelFlash,
  eiffelHalf,
  eiffelPigeons,
  eiffelRows,
} from "../../../src/cli/tui/component/eiffel-view-model"

test.each(["eiffel-day", "eiffel-night"] as const)("%s clips its lattice to resized screens", (style) => {
  expect([EIFFEL_COLUMNS, EIFFEL_ROWS]).toEqual([76, 24])
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [12, 5],
    [36, 20],
    [80, 30],
    [120, 40],
  ]) {
    for (const elapsed of [0, 450, 900]) {
      const rows = eiffelRows(width!, height!, style, elapsed)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  }
  expect(eiffelBackground("eiffel-day")).not.toBe(eiffelBackground("eiffel-night"))
})

test("the lattice widens downward while sparkles take turns", () => {
  expect(eiffelHalf(1)).toBe(1)
  expect(eiffelHalf(19)).toBe(11)
  expect(eiffelFlash(0, 0)).toBe(true)
  expect(eiffelFlash(0, 1)).toBe(false)
  expect(eiffelFlash(150, 0)).toBe(false)
})

test.each(["eiffel-day", "eiffel-night"] as const)("%s renders deterministically", (style) => {
  expect(eiffelRows(76, 24, style, 0)).toEqual(eiffelRows(76, 24, style, 0))
  expect(eiffelRows(76, 24, style, 450)).not.toEqual(eiffelRows(76, 24, style, 0))
  const text = eiffelRows(76, 24, style, 0)
    .map((row) => row.map((run) => run.text).join(""))
    .join("\n")
  expect(text).toContain("/")
  expect(text).toContain("=")
})

test("platforms span the legs", () => {
  const rows = eiffelRows(76, 24, "eiffel-day", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(8)).toContain("=")
  expect(line(14)).toContain("=")
})

test("the beacon sweeps over an arched lawn", () => {
  expect(eiffelBeacon(0)).toBe(true)
  expect(eiffelBeacon(600)).toBe(false)
  expect(eiffelBeam(0)).toBe(-1)
  expect(eiffelBeam(600)).toBe(1)
  const rows = eiffelRows(76, 24, "eiffel-day", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(15)[38]).toBe("#")
  expect(line(22).slice(20, 25)).toBe("=====")
})

test("pigeons, rooftops, a carousel, and a fountain fill the Mars field", () => {
  expect(eiffelPigeons(0)).toEqual([
    { x: 8, y: 4 },
    { x: 25, y: 5 },
    { x: 42, y: 6 },
    { x: 59, y: 4 },
    { x: 76, y: 5 },
  ])
  const rows = eiffelRows(76, 24, "eiffel-day", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(4)[8]).toBe("v")
  expect(line(17).slice(4, 6)).toBe("||")
  expect(line(22).slice(8, 12)).toBe("====")
  expect(line(21)[48]).toBe("~")
  expect(line(22).slice(48, 52)).toBe("[==]")
})
