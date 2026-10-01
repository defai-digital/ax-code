import { expect, test } from "vitest"
import {
  ISLANDS_COLUMNS,
  ISLANDS_CYCLE_MS,
  ISLANDS_ROWS,
  islandsBackground,
  islandsBirds,
  islandsFireflies,
  islandsFlow,
  islandsRows,
} from "../../../src/cli/tui/component/islands-view-model"

test.each(["islands-day", "islands-dusk"] as const)("%s clips its isles to resized screens", (style) => {
  expect([ISLANDS_COLUMNS, ISLANDS_ROWS]).toEqual([76, 24])
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
      const rows = islandsRows(width!, height!, style, elapsed)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  }
  expect(islandsBackground("islands-day")).not.toBe(islandsBackground("islands-dusk"))
})

test("birds circle deterministically over the main isle", () => {
  const first = islandsBirds(0)
  expect(first).toHaveLength(4)
  expect(islandsBirds(0)).toEqual(first)
  expect(islandsBirds(450)).not.toEqual(first)
  expect(islandsBirds(ISLANDS_CYCLE_MS)).toEqual(first)
  expect(islandsBirds(-100)).toEqual(first)
})

test("fireflies rise and blink deterministically at dusk", () => {
  const first = islandsFireflies(0)
  expect(first).toHaveLength(8)
  expect(islandsFireflies(0)).toEqual(first)
  expect(islandsFireflies(450)).not.toEqual(first)
  expect(islandsFireflies(ISLANDS_CYCLE_MS)).toEqual(first)
  expect(islandsFireflies(-100)).toEqual(first)
})

test.each(["islands-day", "islands-dusk"] as const)("%s renders deterministically", (style) => {
  expect(islandsRows(76, 24, style, 0)).toEqual(islandsRows(76, 24, style, 0))
  expect(islandsRows(76, 24, style, 450)).not.toEqual(islandsRows(76, 24, style, 0))
  expect(islandsRows(76, 24, style, ISLANDS_CYCLE_MS)).toEqual(islandsRows(76, 24, style, 0))
  expect(islandsFlow(0)).toBe(0)
  expect(islandsFlow(ISLANDS_CYCLE_MS)).toBe(0)
  const text = islandsRows(76, 24, style, 0)
    .map((row) => row.map((run) => run.text).join(""))
    .join("\n")
  expect(text).toContain("_")
  expect(text).toContain("~")
})

test("the main isle wears a grass cap over a rock root", () => {
  const rows = islandsRows(76, 24, "islands-day", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(10).slice(26, 50)).toBe("_".repeat(24))
  expect(line(15).trim()).not.toBe("")
  expect(line(15)[27]).toBe(":")
})

test("the sea shimmers below the falls", () => {
  const rows = islandsRows(76, 24, "islands-day", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(20)[0]).toBe("~")
  expect(line(20)).toContain("~")
  expect(line(22).trim()).toBe("")
})

test("dusk kindles fireflies under an amber sun", () => {
  const rows = islandsRows(76, 24, "islands-dusk", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(15).slice(32, 37)).toBe("(   )")
  expect(line(16)[7]).toBe("*")
})
