import { expect, test } from "vitest"
import {
  TAEGEUK_COLUMNS,
  TAEGEUK_ROWS,
  taegeukBackground,
  taegeukConfetti,
  taegeukDots,
  taegeukFrame,
  taegeukRed,
  taegeukRows,
  taegeukSparks,
  taegeukWave,
} from "../../../src/cli/tui/component/taegeuk-view-model"

test("taegeuk clips its roundel to resized screens", () => {
  expect([TAEGEUK_COLUMNS, TAEGEUK_ROWS]).toEqual([76, 24])
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [12, 5],
    [36, 20],
    [80, 30],
    [120, 40],
  ]) {
    for (const elapsed of [0, 450, 900]) {
      const rows = taegeukRows(width!, height!, "taegeuk", elapsed)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  }
  expect(taegeukBackground("taegeuk")).toBe("#f2f4fa")
})

test("the halves rotate through four frames", () => {
  expect(taegeukFrame(0)).toBe(0)
  expect(taegeukFrame(300)).toBe(1)
  expect(taegeukFrame(1200)).toBe(0)
  expect(taegeukFrame(-100)).toBe(0)
  expect(taegeukRed(-Math.PI / 2, 0)).toBe(false)
  expect(taegeukRed(-Math.PI / 2, 2)).toBe(true)
})

test("taegeuk renders deterministically", () => {
  expect(taegeukRows(76, 24, "taegeuk", 0)).toEqual(taegeukRows(76, 24, "taegeuk", 0))
  expect(taegeukRows(76, 24, "taegeuk", 450)).not.toEqual(taegeukRows(76, 24, "taegeuk", 0))
  const text = taegeukRows(76, 24, "taegeuk", 0)
    .map((row) => row.map((run) => run.text).join(""))
    .join("\n")
  expect(text).toContain("@")
  expect(text).toContain("%")
  expect(text).toContain("===")
})

test("counter-colored eyes orbit inside a bordered field", () => {
  expect(taegeukDots(0)).toEqual([
    { x: 38, y: 15, red: false },
    { x: 38, y: 8, red: true },
  ])
  expect(taegeukDots(300)).not.toEqual(taegeukDots(0))
  const rows = taegeukRows(76, 24, "taegeuk", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(1)[4]).toBe("+")
  expect(line(1)[71]).toBe("+")
})

test("sparks, confetti, pylons, and a crowd wave celebrate the emblem", () => {
  expect(taegeukConfetti(0)).toHaveLength(12)
  expect(taegeukConfetti(0)[6]).toEqual({ x: 34, y: 11, red: true })
  expect(taegeukSparks(0)).toEqual([
    { x: 47, y: 11 },
    { x: 38, y: 20 },
    { x: 29, y: 11 },
    { x: 38, y: 2 },
  ])
  expect(taegeukWave(0)).toBe(0)
  expect(taegeukWave(300)).toBe(1)
  const rows = taegeukRows(76, 24, "taegeuk", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(11)[34]).toBe("*")
  expect(line(11)[47]).toBe("*")
  expect(line(16)[1]).toBe("|")
  expect(line(20)[4]).toBe("o")
  expect(line(20)[5]).toBe(".")
})
