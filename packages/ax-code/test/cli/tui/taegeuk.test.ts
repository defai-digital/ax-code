import { expect, test } from "vitest"
import {
  TAEGEUK_COLORS,
  TAEGEUK_COLUMNS,
  TAEGEUK_FIELD,
  TAEGEUK_ROWS,
  TAEGEUK_SPIN_MS,
  TAEGEUK_TILT,
  taegeukBackground,
  taegeukBar,
  taegeukConfetti,
  taegeukEmblem,
  taegeukFrame,
  taegeukRows,
  taegeukSparks,
  taegeukSpin,
  taegeukWave,
} from "../../../src/cli/tui/component/taegeuk-view-model"

const cells = (elapsedMs: number) =>
  taegeukRows(76, 24, "taegeuk", elapsedMs).map((row) =>
    row.flatMap((run) => [...run.text].map((text) => ({ text, color: run.color, background: run.background }))),
  )
const lines = (elapsedMs: number) => cells(elapsedMs).map((row) => row.map((cell) => cell.text).join(""))

test("taegeuk clips its flag to resized screens", () => {
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
  expect(taegeukBackground("taegeuk")).toBe("#a8c0e6")
})

test("the emblem turns once and settles in the official orientation", () => {
  expect(taegeukFrame(0)).toBe(0)
  expect(taegeukFrame(300)).toBe(1)
  expect(taegeukFrame(1200)).toBe(0)
  expect(taegeukFrame(-100)).toBe(0)
  expect(taegeukSpin(0)).toBeCloseTo(-2 * Math.PI)
  expect(taegeukSpin(-100)).toBe(taegeukSpin(0))
  expect(taegeukSpin(TAEGEUK_SPIN_MS / 2)).toBeCloseTo(-Math.PI)
  expect(taegeukSpin(TAEGEUK_SPIN_MS)).toBe(0)
  expect(taegeukSpin(60_000)).toBe(0)
})

test("red sits over blue with interlocking heads and no eyes", () => {
  const emblem = taegeukEmblem(0)
  expect(emblem(0, -20)).toBe("red")
  expect(emblem(0, 20)).toBe("blue")
  expect(emblem(30, 0)).toBeUndefined()
  // The red head dips below the midline toward the hoist; the blue head rises toward the fly.
  expect(emblem(-12, 1)).toBe("red")
  expect(emblem(12, -1)).toBe("blue")
  // Head centers carry their own color: there is no counter-colored eye.
  const head = { x: 12 * Math.cos(TAEGEUK_TILT), y: 12 * Math.sin(TAEGEUK_TILT) }
  expect(emblem(-head.x, -head.y)).toBe("red")
  expect(emblem(head.x, head.y)).toBe("blue")
  // The first frame matches the settled flag, and a half turn swaps the halves.
  expect(taegeukEmblem(taegeukSpin(0))(0, -20)).toBe("red")
  expect(taegeukEmblem(Math.PI)(0, -20)).toBe("blue")
})

test("each corner carries its own trigram along the diagonals", () => {
  const cos = Math.cos(TAEGEUK_TILT)
  const sin = Math.sin(TAEGEUK_TILT)
  // Bar centers sit 38, 44, and 50 units out; a broken bar is open there.
  const bars = (signX: number, signY: number) =>
    [38, 44, 50].map((reach) => taegeukBar(signX * reach * cos, signY * reach * sin))
  expect(bars(-1, -1)).toEqual([true, true, true]) // geon, upper hoist
  expect(bars(1, -1)).toEqual([false, true, false]) // gam, upper fly
  expect(bars(-1, 1)).toEqual([true, false, true]) // ri, lower hoist
  expect(bars(1, 1)).toEqual([false, false, false]) // gon, lower fly
  // Broken bars are still inked away from the gap, and bars are separated.
  expect(taegeukBar(38 * cos - 6 * sin, 38 * sin + 6 * cos)).toBe(true)
  expect(taegeukBar(41 * cos, 41 * sin)).toBe(false)
  expect(taegeukBar(0, 0)).toBe(false)
})

test("taegeuk renders deterministically", () => {
  expect(taegeukRows(76, 24, "taegeuk", 0)).toEqual(taegeukRows(76, 24, "taegeuk", 0))
  expect(taegeukRows(76, 24, "taegeuk", 450)).not.toEqual(taegeukRows(76, 24, "taegeuk", 0))
  const text = lines(0).join("\n")
  expect(text).toContain("@")
  expect(text).toContain("%")
  expect(text).toContain("/ / /")
})

test("the text flag is a white 3:2 field with official colors", () => {
  const colors = TAEGEUK_COLORS.taegeuk
  expect([colors.field, colors.red, colors.blue, colors.trigram]).toEqual(["#ffffff", "#cd2e3a", "#0047a0", "#000000"])
  // Cells are twice as tall as wide, so three columns per row is 3:2.
  expect(TAEGEUK_FIELD.x1 - TAEGEUK_FIELD.x0).toBe(3 * (TAEGEUK_FIELD.y1 - TAEGEUK_FIELD.y0))
  for (const elapsed of [0, 450, 3000]) {
    const grid = cells(elapsed)
    for (let y = 0; y < TAEGEUK_ROWS; y++) {
      for (let x = 0; x < TAEGEUK_COLUMNS; x++) {
        const inside = x >= TAEGEUK_FIELD.x0 && x < TAEGEUK_FIELD.x1 && y >= TAEGEUK_FIELD.y0 && y < TAEGEUK_FIELD.y1
        if (!inside) continue
        // Confetti and sparks never mark the field.
        expect(grid[y]![x]!.text).not.toBe("*")
        expect([colors.field, colors.red, colors.blue]).toContain(grid[y]![x]!.background)
      }
    }
  }
  const settled = cells(3000)
  expect(settled[6]![38]).toEqual({ text: "@", color: colors.red, background: colors.red })
  expect(settled[13]![38]).toEqual({ text: "%", color: colors.blue, background: colors.blue })
  expect(settled[1]![11]).toEqual({ text: " ", color: colors.field, background: colors.field })
  const text = lines(3000)
  expect(text[3]!.slice(20, 29)).toBe("    / / /")
  expect(text[5]!.slice(20, 29)).toBe("  / / /  ")
  expect(text[5]!.slice(47, 56)).toBe("    \\    ")
  expect(text[14]!.slice(20, 29)).toBe("  \\   \\  ")
  expect(text[14]!.slice(47, 56)).toBe("         ")
  expect(text[16]!.slice(47, 56)).toBe("/ / /    ")
})

test("sparks, confetti, pylons, and a crowd wave celebrate around the flag", () => {
  expect(taegeukConfetti(0)).toHaveLength(12)
  expect(taegeukConfetti(0)[6]).toEqual({ x: 34, y: 11, red: true })
  expect(taegeukSparks(0)).toEqual([
    { x: 6, y: 3 },
    { x: 69, y: 6 },
    { x: 8, y: 9 },
    { x: 67, y: 12 },
  ])
  expect(taegeukSparks(300)).toEqual([
    { x: 4, y: 6 },
    { x: 71, y: 3 },
    { x: 5, y: 12 },
    { x: 70, y: 9 },
  ])
  for (const spark of [...taegeukSparks(0), ...taegeukSparks(300)]) {
    expect(spark.x < TAEGEUK_FIELD.x0 || spark.x >= TAEGEUK_FIELD.x1).toBe(true)
  }
  expect(taegeukWave(0)).toBe(0)
  expect(taegeukWave(300)).toBe(1)
  const text = lines(0)
  expect(text[3]![6]).toBe("*")
  expect(text[0]![0]).toBe("*")
  expect(text[16]![1]).toBe("|")
  expect(text[20]![4]).toBe("o")
  expect(text[20]![5]).toBe(".")
})
