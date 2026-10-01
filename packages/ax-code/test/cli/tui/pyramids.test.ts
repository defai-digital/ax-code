import { expect, test } from "vitest"
import {
  PYRAMIDS_COLUMNS,
  PYRAMIDS_ROWS,
  pyramidsBackground,
  pyramidsCaravanX,
  pyramidsFlicker,
  pyramidsRows,
} from "../../../src/cli/tui/component/pyramids-view-model"

test.each(["pyramids-day", "pyramids-night"] as const)("%s clips its dunes to resized screens", (style) => {
  expect([PYRAMIDS_COLUMNS, PYRAMIDS_ROWS]).toEqual([76, 24])
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [12, 5],
    [36, 20],
    [80, 30],
    [120, 40],
  ]) {
    for (const elapsed of [0, 450, 900]) {
      const rows = pyramidsRows(width!, height!, style, elapsed)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  }
  expect(pyramidsBackground("pyramids-day")).not.toBe(pyramidsBackground("pyramids-night"))
})

test("the caravan crosses the hardpan deterministically", () => {
  const first = pyramidsCaravanX(0)
  expect(first).toBe(-12)
  expect(pyramidsCaravanX(0)).toEqual(first)
  expect(pyramidsCaravanX(1200)).not.toEqual(first)
  expect(pyramidsCaravanX(2400)).toEqual(first)
  expect(pyramidsCaravanX(-100)).toEqual(first)
})

test.each(["pyramids-day", "pyramids-night"] as const)("%s renders deterministically", (style) => {
  expect(pyramidsRows(76, 24, style, 0)).toEqual(pyramidsRows(76, 24, style, 0))
  expect(pyramidsRows(76, 24, style, 450)).not.toEqual(pyramidsRows(76, 24, style, 0))
  expect(pyramidsRows(76, 24, style, 2400)).toEqual(pyramidsRows(76, 24, style, 0))
  const text = pyramidsRows(76, 24, style, 0)
    .map((row) => row.map((run) => run.text).join(""))
    .join("\n")
  expect(text).toContain("/")
  expect(text).toContain("\\")
})

test("sun, apex, and sphinx anchor the day scene", () => {
  const rows = pyramidsRows(76, 24, "pyramids-day", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(2).slice(58, 63)).toBe("--o--")
  expect(line(7).slice(29, 32)).toBe("/ \\")
  expect(line(13).slice(8, 13)).toBe("|o o|")
})

test("campfire flames flicker over dune ridges at night", () => {
  expect(pyramidsFlicker(0)).toBe(true)
  expect(pyramidsFlicker(200)).toBe(false)
  const rows = pyramidsRows(76, 24, "pyramids-night", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(14).slice(20, 23)).toBe("(*)")
  expect(line(15).slice(19, 24)).toBe("=====")
  expect(line(17).slice(2, 6)).toBe("~~~~")
})
