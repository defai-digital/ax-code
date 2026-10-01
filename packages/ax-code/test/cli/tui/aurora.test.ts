import { expect, test } from "vitest"
import {
  AURORA_COLUMNS,
  AURORA_ROWS,
  auroraBackground,
  auroraRipple,
  auroraRows,
  auroraShimmer,
} from "../../../src/cli/tui/component/aurora-view-model"

test.each(["aurora-night", "aurora-dawn"] as const)("%s clips its curtains to resized screens", (style) => {
  expect([AURORA_COLUMNS, AURORA_ROWS]).toEqual([76, 24])
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [12, 5],
    [36, 20],
    [80, 30],
    [120, 40],
  ]) {
    for (const elapsed of [0, 450, 900]) {
      const rows = auroraRows(width!, height!, style, elapsed)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  }
  expect(auroraBackground("aurora-night")).not.toBe(auroraBackground("aurora-dawn"))
})

test("curtains ripple deterministically over the lake", () => {
  expect(auroraRipple(0, 19)).toBeCloseTo(2, 10)
  expect(auroraRipple(0, 19)).toEqual(auroraRipple(0, 19))
  expect(auroraRipple(1200, 19)).not.toEqual(auroraRipple(0, 19))
  expect(auroraRipple(2400, 19)).toEqual(auroraRipple(0, 19))
  expect(auroraRipple(-100, 19)).toEqual(auroraRipple(0, 19))
})

test.each(["aurora-night", "aurora-dawn"] as const)("%s renders deterministically", (style) => {
  expect(auroraRows(76, 24, style, 0)).toEqual(auroraRows(76, 24, style, 0))
  expect(auroraRows(76, 24, style, 450)).not.toEqual(auroraRows(76, 24, style, 0))
  expect(auroraRows(76, 24, style, 2400)).toEqual(auroraRows(76, 24, style, 0))
  const text = auroraRows(76, 24, style, 0)
    .map((row) => row.map((run) => run.text).join(""))
    .join("\n")
  expect(text).toContain("/\\")
  expect(text).toContain("~")
})

test("pines, mist, and reflections anchor the night scene", () => {
  const rows = auroraRows(76, 24, "aurora-night", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(14).slice(5, 7)).toBe("/\\")
  expect(line(17).slice(0, 3)).toBe("~~~")
  expect(line(19).slice(15, 20)).toBe("=====")
})

test("dawn fades the curtains over a rose horizon", () => {
  expect(auroraShimmer(0)).toBe(true)
  expect(auroraShimmer(200)).toBe(false)
  const rows = auroraRows(76, 24, "aurora-dawn", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(13)).toBe("=".repeat(76))
  expect(line(18)).toBe(" ".repeat(76))
})
