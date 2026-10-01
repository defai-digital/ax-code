import { expect, test } from "vitest"
import {
  BALLOONS_COLUMNS,
  BALLOONS_ROWS,
  balloonsAscend,
  balloonsBackground,
  balloonsBirds,
  balloonsCloudDrift,
  balloonsFlame,
  balloonsRows,
} from "../../../src/cli/tui/component/balloons-view-model"

test.each(["balloons-night", "balloons-dawn"] as const)("%s clips its valley to resized screens", (style) => {
  expect([BALLOONS_COLUMNS, BALLOONS_ROWS]).toEqual([76, 24])
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [12, 5],
    [36, 20],
    [80, 30],
    [120, 40],
  ]) {
    for (const elapsed of [0, 450, 900]) {
      const rows = balloonsRows(width!, height!, style, elapsed)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  }
  expect(balloonsBackground("balloons-night")).not.toBe(balloonsBackground("balloons-dawn"))
})

test("balloons rise through the valley while burners flicker", () => {
  const first = balloonsAscend(0)
  expect(first).toHaveLength(5)
  expect(balloonsAscend(0)).toEqual(first)
  expect(balloonsAscend(450)).not.toEqual(first)
  expect(balloonsAscend(-100)).toEqual(first)
  for (const balloon of first) {
    expect(balloon.y).toBeGreaterThanOrEqual(0)
    expect(balloon.y).toBeLessThanOrEqual(15)
  }
  expect(balloonsFlame(0)).toBe(true)
  expect(balloonsFlame(300)).toBe(false)
})

test.each(["balloons-night", "balloons-dawn"] as const)("%s renders deterministically", (style) => {
  expect(balloonsRows(76, 24, style, 0)).toEqual(balloonsRows(76, 24, style, 0))
  expect(balloonsRows(76, 24, style, 450)).not.toEqual(balloonsRows(76, 24, style, 0))
  const text = balloonsRows(76, 24, style, 0)
    .map((row) => row.map((run) => run.text).join(""))
    .join("\n")
  expect(text).toContain("(")
  expect(text).toContain("[")
})

test("dawn envelopes glow warmer than night envelopes", () => {
  const night = balloonsRows(76, 24, "balloons-night", 0)
  const dawn = balloonsRows(76, 24, "balloons-dawn", 0)
  expect(night.flat().some((run) => run.color === "#5a4a8a")).toBe(true)
  expect(dawn.flat().some((run) => run.color === "#e04a5a")).toBe(true)
})

test("moonrise, drifting clouds, burner glow, and scrub fill the valley", () => {
  expect(balloonsCloudDrift(0)).toBe(0)
  expect(balloonsCloudDrift(600)).toBe(1)
  expect(balloonsCloudDrift(3000)).toBe(0)
  const night = balloonsRows(76, 24, "balloons-night", 0)
  const dawn = balloonsRows(76, 24, "balloons-dawn", 0)
  const line = (rows: typeof night, row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(night, 3)[66]).toBe("O")
  expect(line(dawn, 3)[66]).toBe("O")
  expect(line(night, 7).slice(46, 50)).toBe("~~~~")
  expect(line(night, 14)[21]).toBe(".")
  expect(line(dawn, 20)[25]).toBe("/")
})

test("distant balloons, swifts, cottages, a tether, and grasses fill the valley", () => {
  expect(balloonsBirds(0)).toEqual([
    { x: 12, y: 6 },
    { x: 41, y: 7 },
    { x: 70, y: 6 },
  ])
  const rows = balloonsRows(76, 24, "balloons-night", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(2)[18]).toBe("o")
  expect(line(6)[12]).toBe("v")
  expect(line(18).slice(30, 32)).toBe("||")
  expect(line(18)[37]).toBe("o")
  expect(line(22)[2]).toBe('"')
})
