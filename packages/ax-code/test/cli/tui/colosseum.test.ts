import { expect, test } from "vitest"
import {
  COLOSSEUM_COLUMNS,
  COLOSSEUM_ROWS,
  colosseumBackground,
  colosseumBirds,
  colosseumFlash,
  colosseumRows,
  colosseumTorch,
} from "../../../src/cli/tui/component/colosseum-view-model"

test.each(["colosseum-day", "colosseum-night"] as const)("%s clips its wall to resized screens", (style) => {
  expect([COLOSSEUM_COLUMNS, COLOSSEUM_ROWS]).toEqual([76, 24])
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [12, 5],
    [36, 20],
    [80, 30],
    [120, 40],
  ]) {
    for (const elapsed of [0, 450, 900]) {
      const rows = colosseumRows(width!, height!, style, elapsed)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  }
  expect(colosseumBackground("colosseum-day")).not.toBe(colosseumBackground("colosseum-night"))
})

test("doves cross the sky on a shared round", () => {
  const first = colosseumBirds(0)
  expect(first).toHaveLength(4)
  expect(colosseumBirds(0)).toEqual(first)
  expect(colosseumBirds(450)).not.toEqual(first)
  expect(colosseumBirds(-100)).toEqual(first)
})

test.each(["colosseum-day", "colosseum-night"] as const)("%s renders deterministically", (style) => {
  expect(colosseumRows(76, 24, style, 0)).toEqual(colosseumRows(76, 24, style, 0))
  expect(colosseumRows(76, 24, style, 450)).not.toEqual(colosseumRows(76, 24, style, 0))
  const text = colosseumRows(76, 24, style, 0)
    .map((row) => row.map((run) => run.text).join(""))
    .join("\n")
  expect(text).toContain("|")
  expect(text).toContain("nn")
})

test("a broken crown tops two lit storeys", () => {
  const rows = colosseumRows(76, 24, "colosseum-night", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(7)).toContain("=")
  expect(line(10)).toContain("nn")
  expect(line(14)).toContain("nn")
})

test("banners, a gate, cypresses, and braziers dress the ruin", () => {
  expect(colosseumTorch(0)).toBe(true)
  expect(colosseumTorch(250)).toBe(false)
  const rows = colosseumRows(76, 24, "colosseum-night", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(9)[26]).toBe("V")
  expect(line(9)[47]).toBe("V")
  expect(line(17).slice(36, 40)).toBe("|  |")
  expect(line(18).slice(34, 42)).toBe("========")
  expect(line(16).slice(5, 7)).toBe("||")
  expect(line(18)[10]).toBe("*")
})

test("statues, pines, gladiators, and camera flashes fill the forecourt", () => {
  expect(colosseumFlash(0)).toBe(0)
  expect(colosseumFlash(400)).toBe(1)
  expect(colosseumFlash(2400)).toBe(0)
  expect(colosseumFlash(-100)).toBe(0)
  const rows = colosseumRows(76, 24, "colosseum-night", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(6)[32]).toBe("o")
  expect(line(7)[32]).toBe("|")
  expect(line(6)[48]).toBe("o")
  expect(line(7)[48]).toBe("|")
  expect(line(11).slice(0, 3)).toBe("___")
  expect(line(12)[1]).toBe("|")
  expect(line(11).slice(71, 74)).toBe("___")
  expect(line(17)[33]).toBe("o")
  expect(line(18)[33]).toBe("i")
  expect(line(18)[43]).toBe("i")
  expect(line(18)[7]).toBe("*")
  expect(line(18)[20]).toBe(".")
  const day = colosseumRows(76, 24, "colosseum-day", 0)
  expect(day[1]!.map((run) => run.text).join("").slice(40, 46)).toBe("~~~~~~")
})
