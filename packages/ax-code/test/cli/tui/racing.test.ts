import { expect, test } from "vitest"
import {
  RACING_COLUMNS,
  RACING_ROWS,
  racingBackground,
  racingExhaust,
  racingRival,
  racingRows,
  racingSpeed,
  racingTick,
} from "../../../src/cli/tui/component/racing-view-model"

test.each(["racing-day", "racing-night"] as const)("%s clips its highway to resized screens", (style) => {
  expect([RACING_COLUMNS, RACING_ROWS]).toEqual([76, 24])
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [12, 5],
    [36, 20],
    [80, 30],
    [120, 40],
  ]) {
    for (const elapsed of [0, 450, 900]) {
      const rows = racingRows(width!, height!, style, elapsed)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  }
  expect(racingBackground("racing-day")).not.toBe(racingBackground("racing-night"))
})

test("the rival weaves deterministically ahead of the player", () => {
  const rival = racingRival(0)
  expect(rival).toEqual({ x: 34, y: 11 })
  expect(racingRival(0)).toEqual(rival)
  expect(racingRival(600)).not.toEqual(rival)
  expect(racingRival(2400)).toEqual(rival)
  expect(racingRival(-100)).toEqual(rival)
})

test.each(["racing-day", "racing-night"] as const)("%s renders deterministically", (style) => {
  expect(racingRows(76, 24, style, 0)).toEqual(racingRows(76, 24, style, 0))
  expect(racingRows(76, 24, style, 450)).not.toEqual(racingRows(76, 24, style, 0))
  expect(racingRows(76, 24, style, 2400)).toEqual(racingRows(76, 24, style, 0))
  expect(racingRows(76, 24, style, -100)).toEqual(racingRows(76, 24, style, 0))
  const text = racingRows(76, 24, style, 0)
    .map((row) => row.map((run) => run.text).join(""))
    .join("\n")
  expect(text).toContain("KMH")
  expect(text).toContain("[AX-1]")
})

test("HUD, sun, gantry road, and the black car fill the day opening", () => {
  expect(racingTick(0)).toBe(0)
  expect(racingTick(200)).toBe(1)
  expect(racingSpeed(0)).toBe(148)
  expect(racingSpeed(200)).toBe(151)
  expect(racingSpeed(2400)).toBe(148)
  const rows = racingRows(76, 24, "racing-day", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(0).slice(1, 8)).toBe("148 KMH")
  expect(line(0).slice(69, 74)).toBe("LAP 1")
  expect(line(2).slice(11, 14)).toBe("-o-")
  expect(line(6)).toContain("[ AX-1 ]")
  expect(line(21).slice(32, 34)).toBe("[]")
  expect(line(22).slice(36, 42)).toBe("[AX-1]")
})

test("exhaust flames flicker and the moon rises over the night ending", () => {
  expect(racingExhaust(0)).toBe(true)
  expect(racingExhaust(200)).toBe(false)
  const night = racingRows(76, 24, "racing-night", 0)
  const nightLine = (row: number) => night[row]!.map((run) => run.text).join("")
  expect(nightLine(2)).toContain("(   )")
  expect(nightLine(23).slice(34, 35)).toBe("*")
  const later = racingRows(76, 24, "racing-night", 200)
  expect(
    later[23]!
      .map((run) => run.text)
      .join("")
      .slice(34, 35),
  ).toBe("o")
})
