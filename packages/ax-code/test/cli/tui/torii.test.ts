import { expect, test } from "vitest"
import {
  TORII_COLUMNS,
  TORII_ROWS,
  toriiBackground,
  toriiFlicker,
  toriiPetals,
  toriiRows,
} from "../../../src/cli/tui/component/torii-view-model"

test.each(["torii-day", "torii-night"] as const)("%s clips its gate to resized screens", (style) => {
  expect([TORII_COLUMNS, TORII_ROWS]).toEqual([76, 24])
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [12, 5],
    [36, 20],
    [80, 30],
    [120, 40],
  ]) {
    for (const elapsed of [0, 450, 900]) {
      const rows = toriiRows(width!, height!, style, elapsed)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  }
  expect(toriiBackground("torii-day")).not.toBe(toriiBackground("torii-night"))
})

test("petals drift deterministically past the gate", () => {
  const first = toriiPetals(0)
  expect(first).toHaveLength(10)
  expect(toriiPetals(0)).toEqual(first)
  expect(toriiPetals(1200)).not.toEqual(first)
  expect(toriiPetals(2400)).toEqual(first)
  expect(toriiPetals(-100)).toEqual(first)
})

test.each(["torii-day", "torii-night"] as const)("%s renders deterministically", (style) => {
  expect(toriiRows(76, 24, style, 0)).toEqual(toriiRows(76, 24, style, 0))
  expect(toriiRows(76, 24, style, 450)).not.toEqual(toriiRows(76, 24, style, 0))
  const text = toriiRows(76, 24, style, 0)
    .map((row) => row.map((run) => run.text).join(""))
    .join("\n")
  expect(text).toContain("||")
  expect(text).toContain("=")
})

test("the lintel crowns twin pillars", () => {
  const rows = toriiRows(76, 24, "torii-day", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(5)).toContain("_=")
  expect(line(7).slice(28, 30)).toBe("||")
  expect(line(7).slice(47, 49)).toBe("||")
})

test("stone lanterns flicker over a slab path", () => {
  expect(toriiFlicker(0)).toBe(true)
  expect(toriiFlicker(200)).toBe(false)
  const rows = toriiRows(76, 24, "torii-day", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(14).slice(15, 20)).toBe("=====")
  expect(line(15).slice(16, 19)).toBe("[*]")
  expect(line(20)).toContain("===")
})

test("a shrine, chochin, foxes, worshippers, bamboo, and grasses fill the grounds", () => {
  const rows = toriiRows(76, 24, "torii-day", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(12).slice(34, 40)).toBe("| [] |")
  expect(line(7).slice(31, 33)).toBe("()")
  expect(line(18).slice(24, 26)).toBe("||")
  expect(line(18)[34]).toBe("|")
  expect(line(15)[2]).toBe("|")
  expect(line(22)[1]).toBe('"')
})
