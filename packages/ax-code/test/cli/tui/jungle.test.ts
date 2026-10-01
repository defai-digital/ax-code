import { expect, test } from "vitest"
import {
  JUNGLE_COLUMNS,
  JUNGLE_CYCLE_MS,
  JUNGLE_ROWS,
  jungleBackground,
  jungleFireflies,
  jungleLeaves,
  jungleParrotX,
  jungleRows,
  jungleSway,
} from "../../../src/cli/tui/component/jungle-view-model"

test.each(["jungle-day", "jungle-night"] as const)("%s clips its canopy to resized screens", (style) => {
  expect([JUNGLE_COLUMNS, JUNGLE_ROWS]).toEqual([76, 24])
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [12, 5],
    [36, 20],
    [80, 30],
    [120, 40],
    [200, 60],
  ]) {
    for (const elapsed of [0, 450, 900]) {
      const rows = jungleRows(width!, height!, style, elapsed)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  }
  expect(jungleBackground("jungle-day")).not.toBe(jungleBackground("jungle-night"))
})

test("leaves fall deterministically from the canopy", () => {
  const first = jungleLeaves(0)
  expect(first).toHaveLength(10)
  expect(jungleLeaves(0)).toEqual(first)
  expect(jungleLeaves(450)).not.toEqual(first)
  expect(jungleLeaves(JUNGLE_CYCLE_MS)).toEqual(first)
  expect(jungleLeaves(-100)).toEqual(first)
})

test("fireflies drift deterministically under the night canopy", () => {
  const first = jungleFireflies(0)
  expect(first).toHaveLength(8)
  expect(jungleFireflies(0)).toEqual(first)
  expect(jungleFireflies(450)).not.toEqual(first)
  expect(jungleFireflies(JUNGLE_CYCLE_MS)).toEqual(first)
  expect(jungleFireflies(-100)).toEqual(first)
})

test("the parrot and vines loop with the cycle", () => {
  expect(jungleParrotX(0)).toBe(-4)
  expect(jungleParrotX(1200)).toBe(38)
  expect(jungleParrotX(JUNGLE_CYCLE_MS)).toBe(jungleParrotX(0))
  expect(jungleParrotX(-100)).toBe(jungleParrotX(0))
  expect(jungleSway(JUNGLE_CYCLE_MS, 10)).toBe(jungleSway(0, 10))
  expect(jungleSway(-50, 26)).toBe(jungleSway(0, 26))
})

test.each(["jungle-day", "jungle-night"] as const)("%s renders deterministically", (style) => {
  expect(jungleRows(76, 24, style, 0)).toEqual(jungleRows(76, 24, style, 0))
  expect(jungleRows(76, 24, style, 450)).not.toEqual(jungleRows(76, 24, style, 0))
  expect(jungleRows(76, 24, style, JUNGLE_CYCLE_MS)).toEqual(jungleRows(76, 24, style, 0))
  const text = jungleRows(76, 24, style, 0)
    .map((row) => row.map((run) => run.text).join(""))
    .join("\n")
  expect(text).toContain("|")
  expect(text).toContain("o")
})

test("sun shafts slant past vines while the parrot crosses", () => {
  const rows = jungleRows(76, 24, "jungle-day", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(1)[3]).toBe("o")
  expect(line(7)).toContain("/")
  expect(line(9)[10]).toBe("|")
  const flight = jungleRows(76, 24, "jungle-day", 1200)
  const lane = (row: number) => flight[row]!.map((run) => run.text).join("")
  expect(lane(10).slice(37, 39)).toBe("=>")
})

test("the moon glows through a night glade above the ferns", () => {
  const rows = jungleRows(76, 24, "jungle-night", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(1).slice(60, 65)).toBe("(   )")
  expect(line(21)[1]).toBe('"')
  expect(line(22)[6]).toBe("*")
})
