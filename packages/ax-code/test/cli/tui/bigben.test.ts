import { expect, test } from "vitest"
import {
  BIGBEN_COLUMNS,
  BIGBEN_ROWS,
  bigbenBackground,
  bigbenBirds,
  bigbenBus,
  bigbenClouds,
  bigbenFlag,
  bigbenHands,
  bigbenRows,
  bigbenShimmer,
} from "../../../src/cli/tui/component/bigben-view-model"

test.each(["bigben-day", "bigben-night"] as const)("%s clips its tower to resized screens", (style) => {
  expect([BIGBEN_COLUMNS, BIGBEN_ROWS]).toEqual([76, 24])
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [12, 5],
    [36, 20],
    [80, 30],
    [120, 40],
  ]) {
    for (const elapsed of [0, 450, 900]) {
      const rows = bigbenRows(width!, height!, style, elapsed)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  }
  expect(bigbenBackground("bigben-day")).not.toBe(bigbenBackground("bigben-night"))
})

test("clock hands sweep deterministically on a 2400ms round", () => {
  expect(bigbenHands(0)).toEqual({
    minute: [
      { x: 38, y: 7 },
      { x: 38, y: 6 },
    ],
    hour: [{ x: 38, y: 8 }],
  })
  expect(bigbenHands(600).minute[0]).toEqual({ x: 39, y: 8 })
  expect(bigbenHands(600)).not.toEqual(bigbenHands(0))
  expect(bigbenHands(2400)).toEqual(bigbenHands(0))
  expect(bigbenHands(-100)).toEqual(bigbenHands(0))
})

test("clouds wrap right after crossing the left edge and repeat on their full round", () => {
  expect(bigbenClouds(1600)[0]).toEqual({ x: 91, y: 2 })
  expect(bigbenClouds(18400)).toEqual(bigbenClouds(0))
})

test.each(["bigben-day", "bigben-night"] as const)("%s renders deterministically", (style) => {
  expect(bigbenRows(76, 24, style, 0)).toEqual(bigbenRows(76, 24, style, 0))
  expect(bigbenRows(76, 24, style, 450)).not.toEqual(bigbenRows(76, 24, style, 0))
  const text = bigbenRows(76, 24, style, 0)
    .map((row) => row.map((run) => run.text).join(""))
    .join("\n")
  expect(text).toContain("|")
  expect(text).toContain("/")
})

test("day windows stay dim while night windows glow", () => {
  const day = bigbenRows(76, 24, "bigben-day", 0)
  const night = bigbenRows(76, 24, "bigben-night", 0)
  const line = (rows: typeof day, row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(day, 8)[38]).toBe("o")
  expect(line(day, 12).slice(37, 39)).toBe("::")
  expect(line(night, 12).slice(37, 39)).toBe("##")
  expect(line(night, 2)).toContain("*")
})

test("the flag ripples while the Thames shimmers under the abbey", () => {
  expect(bigbenFlag(0)).toBe(0)
  expect(bigbenFlag(300)).toBe(1)
  expect(bigbenShimmer(0)).toBe(0)
  expect(bigbenShimmer(300)).toBe(1)
  const rows = bigbenRows(76, 24, "bigben-day", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(0).slice(39, 41)).toBe(">>")
  expect(line(17)).toContain("::")
  expect(line(21)).toContain("~")
})

test("a bus crosses under circling rooks while floodlights rake the tower", () => {
  expect(bigbenBus(0)).toBe(-12)
  expect(bigbenBus(1500)).toBe(3)
  expect(bigbenBus(-100)).toBe(-12)
  expect(bigbenBirds(0)[0]).toEqual({ x: 52, y: 6 })
  const day = bigbenRows(76, 24, "bigben-day", 0)
  const night = bigbenRows(76, 24, "bigben-night", 0)
  const late = bigbenRows(76, 24, "bigben-day", 1500)
  const line = (rows: typeof day, row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(late, 18).slice(3, 13)).toBe("[========]")
  expect(line(night, 17)[32]).toBe("/")
  expect(line(night, 19).slice(18, 20)).toBe("nn")
  expect(line(night, 6)[52]).toBe("v")
  expect(line(day, 20)[5]).toBe("|")
})
