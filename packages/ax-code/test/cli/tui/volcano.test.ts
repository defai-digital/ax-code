import { expect, test } from "vitest"
import {
  VOLCANO_COLUMNS,
  VOLCANO_ROWS,
  volcanoBackground,
  volcanoEmbers,
  volcanoGlow,
  volcanoRows,
  volcanoSmoke,
} from "../../../src/cli/tui/component/volcano-view-model"

test.each(["volcano-eruption", "volcano-calm"] as const)("%s clips its cone to resized screens", (style) => {
  expect([VOLCANO_COLUMNS, VOLCANO_ROWS]).toEqual([76, 24])
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [12, 5],
    [36, 20],
    [80, 30],
    [120, 40],
  ]) {
    for (const elapsed of [0, 450, 900]) {
      const rows = volcanoRows(width!, height!, style, elapsed)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  }
  expect(volcanoBackground("volcano-eruption")).not.toBe(volcanoBackground("volcano-calm"))
})

test("embers rise from the crater and flicker deterministically", () => {
  const first = volcanoEmbers(0)
  expect(first).toHaveLength(12)
  expect(volcanoEmbers(0)).toEqual(first)
  expect(volcanoEmbers(450)).not.toEqual(first)
  expect(volcanoEmbers(-100)).toEqual(first)
  for (const ember of first) {
    expect(ember.x).toBeGreaterThanOrEqual(30)
    expect(ember.x).toBeLessThanOrEqual(45)
    expect(ember.y).toBeGreaterThanOrEqual(-4)
    expect(ember.y).toBeLessThanOrEqual(8)
  }
  const visible = (ms: number) => volcanoEmbers(ms).filter((ember) => ember.visible).length
  expect(visible(0)).toBe(8)
  expect(volcanoEmbers(150).map((ember) => ember.visible)).not.toEqual(first.map((ember) => ember.visible))
})

test("the crater pulses on a fixed beat while smoke stays eruption-only", () => {
  expect(volcanoGlow(0)).toBe(0.5)
  expect(volcanoGlow(300)).toBe(1)
  expect(volcanoSmoke(0)).toHaveLength(3)
  for (const puff of volcanoSmoke(0)) {
    expect(puff.y).toBeGreaterThanOrEqual(-4)
    expect(puff.y).toBeLessThanOrEqual(6)
  }
})

test.each(["volcano-eruption", "volcano-calm"] as const)("%s renders deterministically", (style) => {
  expect(volcanoRows(76, 24, style, 0)).toEqual(volcanoRows(76, 24, style, 0))
  expect(volcanoRows(76, 24, style, 450)).not.toEqual(volcanoRows(76, 24, style, 0))
  const text = volcanoRows(76, 24, style, 0)
    .map((row) => row.map((run) => run.text).join(""))
    .join("\n")
  expect(text).toContain("/")
  expect(text).toContain("\\")
})

test("eruption runs lava and smoke while calm keeps moon and stars", () => {
  const eruption = volcanoRows(76, 24, "volcano-eruption", 0)
  const calm = volcanoRows(76, 24, "volcano-calm", 0)
  const text = (rows: typeof eruption) => rows.map((r) => r.map((c) => c.text).join("")).join("\n")
  expect(text(eruption)).toContain("|")
  expect(text(eruption)).toContain("*")
  expect(eruption.flat().some((run) => run.color === "#ff7a2a")).toBe(true)
  expect(calm.flat().some((run) => run.color === "#ff7a2a")).toBe(false)
  expect(calm.flat().some((run) => run.color === "#6a6a7a")).toBe(false)
  expect(text(calm)).toContain("(   )")
  expect(text(calm).split("\n")[0]).toContain("*")
})
