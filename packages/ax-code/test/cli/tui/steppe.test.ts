import { expect, test } from "vitest"
import {
  STEPPE_COLUMNS,
  STEPPE_ROWS,
  steppeBackground,
  steppeClouds,
  steppeHerd,
  steppeRows,
  steppeTick,
} from "../../../src/cli/tui/component/steppe-view-model"

test.each(["steppe-day", "steppe-night"] as const)("%s clips its grassland to resized screens", (style) => {
  expect([STEPPE_COLUMNS, STEPPE_ROWS]).toEqual([76, 24])
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [12, 5],
    [36, 20],
    [80, 30],
    [120, 40],
  ]) {
    for (const elapsed of [0, 450, 900]) {
      const rows = steppeRows(width!, height!, style, elapsed)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  }
  expect(steppeBackground("steppe-day")).not.toBe(steppeBackground("steppe-night"))
})

test("clouds and the herd move deterministically over the grassland", () => {
  const clouds = steppeClouds(0)
  expect(clouds).toHaveLength(3)
  expect(steppeClouds(0)).toEqual(clouds)
  expect(steppeClouds(1200)).not.toEqual(clouds)
  expect(steppeClouds(2400)).toEqual(clouds)
  expect(steppeClouds(-100)).toEqual(clouds)
  const herd = steppeHerd(0)
  expect(herd).toHaveLength(4)
  expect(steppeHerd(0)).toEqual(herd)
  expect(steppeHerd(1200)).not.toEqual(herd)
  expect(steppeHerd(2400)).toEqual(herd)
  expect(steppeHerd(-100)).toEqual(herd)
})

test.each(["steppe-day", "steppe-night"] as const)("%s renders deterministically", (style) => {
  expect(steppeRows(76, 24, style, 0)).toEqual(steppeRows(76, 24, style, 0))
  expect(steppeRows(76, 24, style, 450)).not.toEqual(steppeRows(76, 24, style, 0))
  expect(steppeRows(76, 24, style, 2400)).toEqual(steppeRows(76, 24, style, 0))
  expect(steppeRows(76, 24, style, -100)).toEqual(steppeRows(76, 24, style, 0))
  const text = steppeRows(76, 24, style, 0)
    .map((row) => row.map((run) => run.text).join(""))
    .join("\n")
  expect(text).toContain("(~~~)")
  expect(text).toContain("o>")
})

test("a herd gallops under drifting clouds", () => {
  expect(steppeTick(0)).toBe(0)
  expect(steppeTick(200)).toBe(1)
  const rows = steppeRows(76, 24, "steppe-day", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(2).slice(10, 15)).toBe("(~~~)")
  expect(line(14).slice(8, 10)).toBe("o>")
  expect(line(15).slice(8, 10)).toBe("||")
})

test("a yurt stands with smoke, a door, and a glowing night window", () => {
  const day = steppeRows(76, 24, "steppe-day", 0)
  const dayLine = (row: number) => day[row]!.map((run) => run.text).join("")
  expect(dayLine(12).slice(52, 59)).toBe("/-----\\")
  expect(dayLine(10)[56]).toBe("~")
  expect(dayLine(14).slice(55, 57)).toBe("[]")
  expect(dayLine(13).slice(57, 60)).toBe("[ ]")
  const night = steppeRows(76, 24, "steppe-night", 0)
  const nightLine = (row: number) => night[row]!.map((run) => run.text).join("")
  expect(nightLine(13).slice(57, 60)).toBe("[*]")
  expect(nightLine(2)).toContain("(   )")
})
