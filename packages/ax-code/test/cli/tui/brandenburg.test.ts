import { expect, test } from "vitest"
import {
  BRANDENBURG_COLUMNS,
  BRANDENBURG_ROWS,
  brandenburgBackground,
  brandenburgDoves,
  brandenburgLamp,
  brandenburgRows,
  brandenburgWave,
} from "../../../src/cli/tui/component/brandenburg-view-model"

test.each(["brandenburg-night", "brandenburg-dawn"] as const)("%s clips its gate to resized screens", (style) => {
  expect([BRANDENBURG_COLUMNS, BRANDENBURG_ROWS]).toEqual([76, 24])
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [12, 5],
    [36, 20],
    [80, 30],
    [120, 40],
  ]) {
    for (const elapsed of [0, 450, 900]) {
      const rows = brandenburgRows(width!, height!, style, elapsed)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  }
  expect(brandenburgBackground("brandenburg-night")).not.toBe(brandenburgBackground("brandenburg-dawn"))
})

test("flags ripple through three phases", () => {
  expect(brandenburgWave(0)).toBe(0)
  expect(brandenburgWave(300)).toBe(1)
  expect(brandenburgWave(900)).toBe(0)
  expect(brandenburgWave(-100)).toBe(0)
})

test.each(["brandenburg-night", "brandenburg-dawn"] as const)("%s renders deterministically", (style) => {
  expect(brandenburgRows(76, 24, style, 0)).toEqual(brandenburgRows(76, 24, style, 0))
  expect(brandenburgRows(76, 24, style, 450)).not.toEqual(brandenburgRows(76, 24, style, 0))
  const text = brandenburgRows(76, 24, style, 0)
    .map((row) => row.map((run) => run.text).join(""))
    .join("\n")
  expect(text).toContain("|||")
  expect(text).toContain("#")
})

test("six pillars carry the lintel under waving flags", () => {
  const rows = brandenburgRows(76, 24, "brandenburg-night", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(4)).toContain(">>>")
  expect(line(8)).toContain("#")
  expect(line(12)[24]).toBe("*")
})

test("Victory crowns a relief band over breathing lamps", () => {
  expect(brandenburgLamp(0)).toBe(true)
  expect(brandenburgLamp(400)).toBe(false)
  const rows = brandenburgRows(76, 24, "brandenburg-night", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(4)[37]).toBe("^")
  expect(line(8)[19]).toBe("o")
  expect(line(19)).toContain(".")
})

test("doves, the moon, plaza lamps, tourists, and flowers fill the square", () => {
  expect(brandenburgDoves(0)).toEqual([
    { x: 6, y: 2 },
    { x: 25, y: 3 },
    { x: 44, y: 2 },
    { x: 63, y: 3 },
  ])
  const rows = brandenburgRows(76, 24, "brandenburg-night", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(2)[6]).toBe("v")
  expect(line(2).slice(60, 65)).toBe("(   )")
  expect(line(17)[10]).toBe("|")
  expect(line(18)[38]).toBe("|")
  expect(line(21)[4]).toBe("@")
})
