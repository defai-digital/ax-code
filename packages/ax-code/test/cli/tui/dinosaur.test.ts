import { expect, test } from "vitest"
import {
  DINOSAUR_COLUMNS,
  DINOSAUR_ROWS,
  dinosaurBackground,
  dinosaurPtero,
  dinosaurRows,
  dinosaurTick,
  dinosaurWalker,
} from "../../../src/cli/tui/component/dinosaur-view-model"

test.each(["dinosaur-day", "dinosaur-night"] as const)("%s clips its valley to resized screens", (style) => {
  expect([DINOSAUR_COLUMNS, DINOSAUR_ROWS]).toEqual([76, 24])
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [12, 5],
    [36, 20],
    [80, 30],
    [120, 40],
  ]) {
    for (const elapsed of [0, 450, 900]) {
      const rows = dinosaurRows(width!, height!, style, elapsed)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  }
  expect(dinosaurBackground("dinosaur-day")).not.toBe(dinosaurBackground("dinosaur-night"))
})

test("the pterosaur and the baby dinosaur cross deterministically", () => {
  const ptero = dinosaurPtero(0)
  expect(ptero).toEqual({ x: 0, y: 3 })
  expect(dinosaurPtero(0)).toEqual(ptero)
  expect(dinosaurPtero(1800)).not.toEqual(ptero)
  expect(dinosaurPtero(3600)).toEqual(ptero)
  expect(dinosaurPtero(-100)).toEqual(ptero)
  const walker = dinosaurWalker(0)
  expect(walker).toEqual({ x: 68, y: 20 })
  expect(dinosaurWalker(1800).x).toBeLessThan(walker.x)
  // One crossing on the action envelope: the walker arrives and holds its end pose.
  expect(dinosaurWalker(1900).x).toBe(8)
  expect(dinosaurWalker(2500)).toEqual(dinosaurWalker(3600))
})

test.each(["dinosaur-day", "dinosaur-night"] as const)("%s renders deterministically", (style) => {
  expect(dinosaurRows(76, 24, style, 0)).toEqual(dinosaurRows(76, 24, style, 0))
  expect(dinosaurRows(76, 24, style, 900)).not.toEqual(dinosaurRows(76, 24, style, 0))
  // The baby dinosaur settles instead of wrapping, so the frame no longer repeats at 3600ms.
  expect(dinosaurRows(76, 24, style, 3600)).not.toEqual(dinosaurRows(76, 24, style, 0))
  expect(dinosaurRows(76, 24, style, -100)).toEqual(dinosaurRows(76, 24, style, 0))
  const text = dinosaurRows(76, 24, style, 0)
    .map((row) => row.map((run) => run.text).join(""))
    .join("\n")
  expect(text).toContain("(o o o)")
  expect(text).toContain("()")
})

test("sun, sauropod, footprints, and the nest fill the day opening", () => {
  expect(dinosaurTick(0)).toBe(0)
  expect(dinosaurTick(300)).toBe(1)
  const rows = dinosaurRows(76, 24, "dinosaur-day", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(2).slice(61, 64)).toBe("-o-")
  expect(line(3).slice(0, 3)).toBe("/v\\")
  expect(line(8).slice(20, 21)).toBe("o")
  expect(line(21).slice(58, 65)).toBe("(o o o)")
  expect(line(22).slice(6, 8)).toBe("()")
})

test("the sauropod eye glows under the moon in the night ending", () => {
  const night = dinosaurRows(76, 24, "dinosaur-night", 0)
  const nightLine = (row: number) => night[row]!.map((run) => run.text).join("")
  expect(nightLine(2)).toContain("(   )")
  expect(nightLine(8).slice(20, 21)).toBe("*")
  expect(nightLine(16)).toContain("*")
})
