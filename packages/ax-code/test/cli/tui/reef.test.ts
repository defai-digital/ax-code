import { expect, test } from "vitest"
import {
  REEF_COLUMNS,
  REEF_CYCLE_MS,
  REEF_ROWS,
  reefBackground,
  reefBubbles,
  reefFish,
  reefPlankton,
  reefRipple,
  reefRows,
  reefSway,
} from "../../../src/cli/tui/component/reef-view-model"

test.each(["reef-day", "reef-night"] as const)("%s clips its reef to resized screens", (style) => {
  expect([REEF_COLUMNS, REEF_ROWS]).toEqual([76, 24])
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
      const rows = reefRows(width!, height!, style, elapsed)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  }
  expect(reefBackground("reef-day")).not.toBe(reefBackground("reef-night"))
})

test("the school sweeps deterministically across the reef", () => {
  const first = reefFish(0)
  expect(first).toHaveLength(6)
  expect(reefFish(0)).toEqual(first)
  expect(reefFish(0)[0]).toEqual({ x: -6, y: 8 })
  expect(reefFish(1200)[0]).toEqual({ x: 38, y: 8 })
  expect(reefFish(450)).not.toEqual(first)
  expect(reefFish(REEF_CYCLE_MS)).toEqual(first)
  expect(reefFish(-100)).toEqual(first)
})

test("bubbles rise deterministically from the reef", () => {
  const first = reefBubbles(0)
  expect(first).toHaveLength(8)
  expect(reefBubbles(0)).toEqual(first)
  expect(reefBubbles(450)).not.toEqual(first)
  expect(reefBubbles(REEF_CYCLE_MS)).toEqual(first)
  expect(reefBubbles(-100)).toEqual(first)
})

test("plankton drifts deterministically through night water", () => {
  const first = reefPlankton(0)
  expect(first).toHaveLength(10)
  expect(reefPlankton(0)).toEqual(first)
  expect(reefPlankton(450)).not.toEqual(first)
  expect(reefPlankton(REEF_CYCLE_MS)).toEqual(first)
  expect(reefPlankton(-100)).toEqual(first)
})

test("kelp sway and ripples loop with the cycle", () => {
  expect(reefSway(REEF_CYCLE_MS, 2)).toBe(reefSway(0, 2))
  expect(reefSway(-50, 70)).toBe(reefSway(0, 70))
  expect(reefRipple(0)).toBe(0)
  expect(reefRipple(REEF_CYCLE_MS)).toBe(0)
})

test.each(["reef-day", "reef-night"] as const)("%s renders deterministically", (style) => {
  expect(reefRows(76, 24, style, 0)).toEqual(reefRows(76, 24, style, 0))
  expect(reefRows(76, 24, style, 450)).not.toEqual(reefRows(76, 24, style, 0))
  expect(reefRows(76, 24, style, REEF_CYCLE_MS)).toEqual(reefRows(76, 24, style, 0))
  const text = reefRows(76, 24, style, 0)
    .map((row) => row.map((run) => run.text).join(""))
    .join("\n")
  expect(text).toContain("~")
  expect(text).toContain("Y")
})

test("corals branch over a shelled sand", () => {
  const rows = reefRows(76, 24, "reef-day", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(17)[40]).toBe("Y")
  expect(line(18)[38]).toBe("*")
  expect(line(19).slice(39, 42)).toBe("\\|/")
  expect(line(21)[12]).toBe("o")
  expect(line(22)[46]).toBe("*")
})

test("the school crosses past the rays at mid-cycle", () => {
  const rows = reefRows(76, 24, "reef-day", 1200)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(8).slice(38, 41)).toBe("><>")
  expect(line(10).slice(34, 37)).toBe("><>")
})
