import { expect, test } from "vitest"
import {
  CASTLE_COLUMNS,
  CASTLE_CYCLE_MS,
  CASTLE_ROWS,
  castleBackground,
  castleBeaconBright,
  castleBirdShift,
  castleCloudShift,
  castleRows,
  castleTwinkle,
  castleWave,
} from "../../../src/cli/tui/component/castle-view-model"

test.each(["castle-day", "castle-night"] as const)("%s clips its scene to resized screens", (style) => {
  expect([CASTLE_COLUMNS, CASTLE_ROWS]).toEqual([76, 24])
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [12, 5],
    [36, 20],
    [80, 30],
    [120, 40],
  ]) {
    for (const elapsed of [0, 450, 900]) {
      const rows = castleRows(width!, height!, style, elapsed)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  }
  expect(castleBackground("castle-day")).not.toBe(castleBackground("castle-night"))
})

test("clouds, birds, banners, and the beacon move deterministically", () => {
  expect(castleCloudShift(0)).toBe(0)
  expect(castleCloudShift(1200)).toBe(8)
  expect(castleCloudShift(CASTLE_CYCLE_MS)).toBe(0)
  expect(castleBirdShift(0)).toBe(0)
  expect(castleBirdShift(1200)).toBe(12)
  expect(castleBirdShift(CASTLE_CYCLE_MS)).toBe(0)
  expect(castleWave(0)).toBe(true)
  expect(castleWave(600)).toBe(false)
  expect(castleWave(CASTLE_CYCLE_MS)).toBe(true)
  expect(castleBeaconBright(0)).toBe(true)
  expect(castleBeaconBright(400)).toBe(false)
  expect(castleBeaconBright(CASTLE_CYCLE_MS)).toBe(true)
  expect(castleTwinkle(0, 0)).toBe(true)
  expect(castleTwinkle(0, 1)).toBe(false)
  expect(castleTwinkle(-100, 0)).toBe(true)
})

test.each(["castle-day", "castle-night"] as const)("%s renders deterministically", (style) => {
  expect(castleRows(76, 24, style, 0)).toEqual(castleRows(76, 24, style, 0))
  expect(castleRows(76, 24, style, 450)).not.toEqual(castleRows(76, 24, style, 0))
  expect(castleRows(76, 24, style, CASTLE_CYCLE_MS)).toEqual(castleRows(76, 24, style, 0))
  expect(castleRows(76, 24, style, -100)).toEqual(castleRows(76, 24, style, 0))
})

test("the day castle flies banners over a gated keep", () => {
  const rows = castleRows(76, 24, "castle-day", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(10).slice(31, 45)).toBe("#_#_#_#_#_#_#_")
  expect(line(6).slice(38, 41)).toBe("=>>")
  expect(line(3).slice(8, 12)).toBe("(~~)")
  expect(line(5)[18]).toBe("v")
  expect(line(15).slice(36, 40)).toBe(".--.")
  expect(line(13).slice(34, 37)).toBe("[ ]")
  expect(line(19).slice(6, 8)).toBe("||")
  expect(line(2).slice(10, 15)).toBe("(   )")
})

test("the night castle glows under a beacon and moon", () => {
  const rows = castleRows(76, 24, "castle-night", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(13).slice(34, 37)).toBe("[*]")
  expect(line(6)[27]).toBe("*")
  expect(line(2).slice(60, 65)).toBe("(   )")
  expect(line(6).slice(38, 41)).toBe("=>>")
  expect(line(0)[4]).toBe("*")
})
