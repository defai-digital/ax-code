import { expect, test } from "vitest"
import {
  SNOW_COLUMNS,
  SNOW_CYCLE_MS,
  SNOW_RIDGE,
  SNOW_ROWS,
  snowBackground,
  snowFlakeGlyph,
  snowFlakes,
  snowHaloTicks,
  snowRows,
  snowShadowDX,
} from "../../../src/cli/tui/component/snow-view-model"

test.each(["snowfall", "winter-night"] as const)("%s clips its forest to resized screens", (style) => {
  expect([SNOW_COLUMNS, SNOW_ROWS]).toEqual([74, 20])
  expect(SNOW_CYCLE_MS).toBe(3000)
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [12, 5],
    [36, 20],
    [80, 30],
    [120, 40],
  ]) {
    for (const elapsed of [0, 750, 1500]) {
      const rows = snowRows(width!, height!, style, elapsed)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  }
  expect(snowBackground("snowfall")).not.toBe(snowBackground("winter-night"))
})

test("flakes fall deterministically below the celestial band and loop", () => {
  const first = snowFlakes(0)
  expect(first).toHaveLength(14)
  expect(snowFlakes(0)).toEqual(first)
  expect(snowFlakes(1500)).not.toEqual(first)
  expect(snowFlakes(3000)).toEqual(first)
  expect(snowFlakes(-100)).toEqual(first)
  for (const flake of first) {
    expect(flake.x).toBeGreaterThanOrEqual(0)
    expect(flake.x).toBeLessThan(SNOW_COLUMNS)
    expect(flake.y).toBeGreaterThanOrEqual(3)
    expect(flake.y).toBeLessThan(16)
  }
})

test.each(["snowfall", "winter-night"] as const)("%s keeps a fixed celestial band and loops", (style) => {
  const first = snowRows(74, 20, style, 0)
  expect(snowRows(74, 20, style, 0)).toEqual(first)
  expect(snowRows(74, 20, style, 1500)).not.toEqual(first)
  expect(snowRows(74, 20, style, 3000)).toEqual(first)
  expect(snowRows(74, 20, style, 1500).slice(0, 3)).toEqual(first.slice(0, 3))
})

test("day and night share the forest with distinct sky and snow", () => {
  const day = snowRows(74, 20, "snowfall", 0)
  const night = snowRows(74, 20, "winter-night", 0)
  const text = (rows: typeof day) => rows.map((r) => r.map((c) => c.text).join("")).join("\n")
  for (const scene of [day, night]) {
    expect(text(scene)).toContain("(   )")
    expect(text(scene)).toContain("/")
    expect(text(scene)).toContain("\\")
    expect(text(scene)).toContain("||")
  }
  expect(text(night).split("\n")[0]).toContain("*")
  expect(day.flat().some((run) => run.color === "#2f6b4f")).toBe(true)
  expect(night.flat().some((run) => run.color === "#1d4032")).toBe(true)
  expect(day.flat().some((run) => run.background === "#eef3fa")).toBe(true)
  expect(night.flat().some((run) => run.background === "#7e93b8")).toBe(true)
})

test("flakes twinkle between glyphs on a shared 500ms beat", () => {
  expect(snowFlakeGlyph("@", 0)).toBe("@")
  expect(snowFlakeGlyph("@", 500)).toBe("*")
  expect(snowFlakeGlyph("*", 0)).toBe("*")
  expect(snowFlakeGlyph("*", 500)).toBe(".")
  expect(snowFlakeGlyph(".", 9999)).toBe(".")
  expect(snowFlakeGlyph("@", 3000)).toBe("@")
})

test.each(["snowfall", "winter-night"] as const)("%s halos the orb and shades pines and ground", (style) => {
  const day = style === "snowfall"
  const ticks = snowHaloTicks(style)
  expect(ticks).toHaveLength(4)
  expect(ticks).toContainEqual(day ? { x: 55, y: 2 } : { x: 11, y: 2 })
  expect(snowShadowDX(style)).toBe(day ? -1 : 1)
  const rows = snowRows(74, 20, style, 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(0)[day ? 59 : 15]).toBe(".")
  // Pine tiers alternate snow and pine edges over a deep interior.
  const pine = day ? "#2f6b4f" : "#1d4032"
  const deep = day ? "#23563f" : "#16352a"
  expect(rows.flat().some((run) => run.color === "#ffffff" || run.color === "#dfe8f5")).toBe(true)
  expect(rows.flat().some((run) => run.color === pine)).toBe(true)
  expect(rows.flat().some((run) => run.background === deep)).toBe(true)
  // Ground shadows pool beneath the pines without hiding the sparks.
  const shadow = day ? "#aeb9cc" : "#4a5a78"
  expect(rows.flat().some((run) => run.background === shadow)).toBe(true)
  expect(line(17)[5]).toBe("*")
})

test("a third ridge peak adds depth behind the pines", () => {
  expect(SNOW_RIDGE).toHaveLength(3)
  const rows = snowRows(74, 20, "snowfall", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(10)[55]).toBe("/")
  expect(line(10)[57]).toBe("\\")
})

test.each(["snowfall", "winter-night"] as const)("%s layers ridge, near flakes, and glinting sparks", (style) => {
  const first = snowRows(74, 20, style, 0)
  const line = (row: number) => first[row]!.map((run) => run.text).join("")
  // Distant peak slopes peek through the pine gaps.
  expect(line(11)[33]).toBe("/")
  expect(line(8)[17]).toBe("\\")
  expect(first.flat().some((run) => run.color === (style === "snowfall" ? "#7c8fb4" : "#2c3c60"))).toBe(true)
  // Near flakes render large.
  expect(first.map((row) => row.map((run) => run.text).join("")).join("\n")).toContain("@")
  // The first ground spark glints bright, then dims.
  expect(line(17)[5]).toBe("*")
  expect(
    snowRows(74, 20, style, 300)[17]!
      .map((run) => run.text)
      .join("")[5],
  ).toBe(".")
})
