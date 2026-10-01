import { expect, test } from "vitest"
import {
  CANYON_COLUMNS,
  CANYON_ROWS,
  canyonBackground,
  canyonEagle,
  canyonFlicker,
  canyonRows,
  canyonTick,
} from "../../../src/cli/tui/component/canyon-view-model"

test.each(["canyon-day", "canyon-night"] as const)("%s clips its canyon to resized screens", (style) => {
  expect([CANYON_COLUMNS, CANYON_ROWS]).toEqual([76, 24])
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [12, 5],
    [36, 20],
    [80, 30],
    [120, 40],
  ]) {
    for (const elapsed of [0, 450, 900]) {
      const rows = canyonRows(width!, height!, style, elapsed)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  }
  expect(canyonBackground("canyon-day")).not.toBe(canyonBackground("canyon-night"))
})

test("the eagle soars deterministically over the canyon", () => {
  const eagle = canyonEagle(0)
  expect(eagle).toEqual({ x: 0, y: 4 })
  expect(canyonEagle(0)).toEqual(eagle)
  expect(canyonEagle(1200)).not.toEqual(eagle)
  expect(canyonEagle(2400)).toEqual(eagle)
  expect(canyonEagle(-100)).toEqual(eagle)
})

test.each(["canyon-day", "canyon-night"] as const)("%s renders deterministically", (style) => {
  expect(canyonRows(76, 24, style, 0)).toEqual(canyonRows(76, 24, style, 0))
  expect(canyonRows(76, 24, style, 450)).not.toEqual(canyonRows(76, 24, style, 0))
  expect(canyonRows(76, 24, style, 2400)).toEqual(canyonRows(76, 24, style, 0))
  expect(canyonRows(76, 24, style, -100)).toEqual(canyonRows(76, 24, style, 0))
  const text = canyonRows(76, 24, style, 0)
    .map((row) => row.map((run) => run.text).join(""))
    .join("\n")
  expect(text).toContain("~~=")
  expect(text).toContain("#")
})

test("sun, eagle, strata, and a glinting river fill the day scene", () => {
  expect(canyonTick(0)).toBe(0)
  expect(canyonTick(200)).toBe(1)
  const rows = canyonRows(76, 24, "canyon-day", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(2).slice(11, 14)).toBe("-o-")
  expect(line(4).slice(0, 3)).toBe("/v\\")
  expect(line(8).slice(0, 6)).toBe("######")
  expect(line(16).slice(0, 4)).toBe("~~=~")
})

test("a campfire flickers on the canyon floor at night", () => {
  expect(canyonFlicker(0)).toBe(true)
  expect(canyonFlicker(200)).toBe(false)
  const night = canyonRows(76, 24, "canyon-night", 0)
  const nightLine = (row: number) => night[row]!.map((run) => run.text).join("")
  expect(nightLine(18).slice(38, 41)).toBe("[*]")
  expect(nightLine(19).slice(36, 41)).toBe("o   o")
  expect(nightLine(2)).toContain("(   )")
  const day = canyonRows(76, 24, "canyon-day", 0)
  const dayLine = (row: number) => day[row]!.map((run) => run.text).join("")
  expect(dayLine(18).slice(38, 41)).toBe("[ ]")
})
