import { expect, test } from "vitest"
import {
  DUNGEON_COLUMNS,
  DUNGEON_CYCLE_MS,
  DUNGEON_ROWS,
  dungeonBackground,
  dungeonDripY,
  dungeonFlicker,
  dungeonRows,
  dungeonTwinkle,
} from "../../../src/cli/tui/component/dungeon-view-model"

test.each(["dungeon-descent", "dungeon-treasure"] as const)("%s clips its scene to resized screens", (style) => {
  expect([DUNGEON_COLUMNS, DUNGEON_ROWS]).toEqual([76, 24])
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [12, 5],
    [36, 20],
    [80, 30],
    [120, 40],
  ]) {
    for (const elapsed of [0, 450, 900]) {
      const rows = dungeonRows(width!, height!, style, elapsed)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  }
  expect(dungeonBackground("dungeon-descent")).not.toBe(dungeonBackground("dungeon-treasure"))
})

test("drips fall and torches flicker deterministically", () => {
  expect([dungeonDripY(0, 0), dungeonDripY(0, 1), dungeonDripY(0, 2)]).toEqual([2, 7, 12])
  expect(dungeonDripY(1200, 0)).toBe(9)
  expect(dungeonDripY(DUNGEON_CYCLE_MS, 1)).toBe(dungeonDripY(0, 1))
  expect(dungeonDripY(-100, 2)).toBe(dungeonDripY(0, 2))
  expect(dungeonFlicker(0)).toBe(true)
  expect(dungeonFlicker(200)).toBe(false)
  expect(dungeonFlicker(DUNGEON_CYCLE_MS)).toBe(true)
  expect(dungeonTwinkle(0, 0)).toBe(true)
  expect(dungeonTwinkle(0, 2)).toBe(false)
  expect(dungeonTwinkle(DUNGEON_CYCLE_MS, 0)).toBe(true)
})

test.each(["dungeon-descent", "dungeon-treasure"] as const)("%s renders deterministically", (style) => {
  expect(dungeonRows(76, 24, style, 0)).toEqual(dungeonRows(76, 24, style, 0))
  expect(dungeonRows(76, 24, style, 450)).not.toEqual(dungeonRows(76, 24, style, 0))
  expect(dungeonRows(76, 24, style, DUNGEON_CYCLE_MS)).toEqual(dungeonRows(76, 24, style, 0))
  expect(dungeonRows(76, 24, style, -100)).toEqual(dungeonRows(76, 24, style, 0))
})

test("the stairway descends past torches and drips", () => {
  const rows = dungeonRows(76, 24, "dungeon-descent", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(4).slice(6, 13)).toBe("_______")
  expect(line(5)[13]).toBe("|")
  expect(line(8)[10]).toBe("*")
  expect(line(2)[22]).toBe("o")
  expect(line(20).slice(55, 62)).toBe("_______")
})

test("the vault holds a glowing chest between pillars", () => {
  const rows = dungeonRows(76, 24, "dungeon-treasure", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(16).slice(34, 42)).toBe(".------.")
  expect(line(17).slice(34, 42)).toBe("| $$$$ |")
  expect(line(18).slice(34, 42)).toBe("'------'")
  expect(line(19).slice(28, 31)).toBe("$$$")
  expect(line(19).slice(45, 48)).toBe("$$$")
  expect(line(18)[29]).toBe("*")
  expect(line(11).slice(7, 11)).toBe("====")
  expect(line(15).slice(8, 10)).toBe("||")
})
