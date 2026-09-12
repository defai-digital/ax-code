import { describe, expect, test } from "vitest"
import {
  MATRIX_RAIN_COLUMN_SPACING,
  MATRIX_RAIN_DURATION_MS,
  MATRIX_RAIN_GLYPHS,
  MATRIX_RAIN_LEVELS,
  MATRIX_RAIN_MAX_DURATION_MS,
  MATRIX_RAIN_MIN_DURATION_MS,
  advanceMatrixRain,
  createMatrixRain,
  matrixRainRows,
  shouldAutoPlayMatrixRain,
  shouldStopMatrixRain,
  tickMatrixRain,
} from "../../../src/cli/cmd/tui/component/matrix-rain-view-model"

// Deterministic PRNG (mulberry32) so frames are reproducible in assertions.
function seeded(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const GRID = { width: 80, height: 24 } as const

describe("matrix rain glyph set", () => {
  test("uses ASCII only", () => {
    for (const char of MATRIX_RAIN_GLYPHS) {
      expect(char.codePointAt(0)).toBeLessThan(0x80)
    }
    expect(MATRIX_RAIN_GLYPHS.length).toBeGreaterThan(0)
  })
})

describe("matrix rain frames", () => {
  test("renders exactly width x height cells", () => {
    const state = createMatrixRain({ ...GRID, random: seeded(1) })
    const rows = matrixRainRows(state)
    expect(rows).toHaveLength(GRID.height)
    for (const row of rows) {
      expect(row.map((run) => run.text).join("")).toHaveLength(GRID.width)
    }
  })

  test("stays ASCII-only and within the brightness range over many frames", () => {
    let state = createMatrixRain({ ...GRID, random: seeded(7) })
    for (let tick = 0; tick < 200; tick++) {
      const rows = matrixRainRows(state)
      for (const row of rows) {
        for (const run of row) {
          expect(run.level).toBeGreaterThanOrEqual(0)
          expect(run.level).toBeLessThanOrEqual(MATRIX_RAIN_LEVELS)
          for (const char of run.text) {
            expect(char.codePointAt(0)).toBeLessThan(0x80)
          }
          if (run.level === 0) {
            expect(run.text.trim()).toBe("")
          } else {
            expect(run.text).not.toContain(" ")
          }
        }
      }
      state = advanceMatrixRain(state)
    }
  })

  test("merges adjacent cells of equal brightness into single runs", () => {
    const state = createMatrixRain({ ...GRID, random: seeded(3) })
    for (const run of matrixRainRows(state)[Math.floor(GRID.height / 2)] ?? []) {
      expect(run.text.length).toBeGreaterThan(0)
    }
    // Run count is bounded by the column count plus one, which is the whole
    // point of spacing columns: per-frame span count stays independent of width.
    for (const row of matrixRainRows(state)) {
      expect(row.length).toBeLessThanOrEqual(state.columns.length + 1)
      for (let i = 1; i < row.length; i++) {
        expect(row[i]!.level).not.toBe(row[i - 1]!.level)
      }
    }
  })

  test("spaces columns so the lit cell count stays bounded", () => {
    const state = createMatrixRain({ ...GRID, random: seeded(11) })
    const xs = state.columns.map((column) => column.x).sort((a, b) => a - b)
    expect(xs.length).toBeGreaterThan(0)
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(MATRIX_RAIN_COLUMN_SPACING)
    }
  })

  test("is deterministic for a fixed random source", () => {
    const first = matrixRainRows(createMatrixRain({ ...GRID, random: seeded(42) }))
    const second = matrixRainRows(createMatrixRain({ ...GRID, random: seeded(42) }))
    expect(second).toEqual(first)
  })
})

describe("matrix rain advance", () => {
  test("moves a column head down by its speed", () => {
    const state = createMatrixRain({ ...GRID, random: seeded(5) })
    const before = state.columns[0]!
    const after = advanceMatrixRain(state).columns[0]!
    expect(after.head).toBeCloseTo(before.head + before.speed, 10)
  })

  test("recycles columns and keeps every frame valid", () => {
    let state = createMatrixRain({ width: 40, height: 10, random: seeded(9) })
    for (let tick = 0; tick < 400; tick++) {
      state = advanceMatrixRain(state)
      const rows = matrixRainRows(state)
      expect(rows).toHaveLength(10)
      for (const row of rows) {
        expect(row.map((run) => run.text).join("")).toHaveLength(40)
      }
    }
  })

  test("handles a tiny terminal without throwing", () => {
    let state = createMatrixRain({ width: 1, height: 1, random: seeded(13) })
    for (let tick = 0; tick < 20; tick++) {
      expect(() => matrixRainRows(state)).not.toThrow()
      state = advanceMatrixRain(state)
    }
  })
})

describe("matrix rain resize", () => {
  test("advances without rebuilding when the size is unchanged", () => {
    const state = createMatrixRain({ ...GRID, random: seeded(17) })
    const next = tickMatrixRain(state, { ...GRID })
    expect(next.width).toBe(state.width)
    expect(next.height).toBe(state.height)
    expect(next.columns[0]!.head).toBeCloseTo(state.columns[0]!.head + state.columns[0]!.speed, 10)
  })

  test("rebuilds the grid on resize so no row exceeds the new width", () => {
    const state = createMatrixRain({ ...GRID, random: seeded(19) })
    for (const size of [
      { width: 40, height: 12 },
      { width: 120, height: 30 },
      { width: 20, height: 6 },
    ]) {
      const resized = tickMatrixRain(state, size)
      expect(resized.width).toBe(size.width)
      expect(resized.height).toBe(size.height)
      const rows = matrixRainRows(resized)
      expect(rows).toHaveLength(size.height)
      for (const row of rows) {
        expect(row.map((run) => run.text).join("")).toHaveLength(size.width)
      }
    }
  })
})

describe("matrix rain duration", () => {
  test("stays inside the requested 3 to 5 second window", () => {
    expect(MATRIX_RAIN_MIN_DURATION_MS).toBeGreaterThanOrEqual(3_000)
    expect(MATRIX_RAIN_MAX_DURATION_MS).toBeLessThanOrEqual(5_000)
    expect(MATRIX_RAIN_DURATION_MS).toBeGreaterThanOrEqual(MATRIX_RAIN_MIN_DURATION_MS)
    expect(MATRIX_RAIN_DURATION_MS).toBeLessThanOrEqual(MATRIX_RAIN_MAX_DURATION_MS)
  })
})

describe("matrix rain auto-play gate", () => {
  const base = {
    enabled: true,
    animationsEnabled: true,
    runtime: "source" as const,
    alreadyPlaying: false,
    dialogOpen: false,
    hasSelection: false,
  }

  test("plays only when every gate is clear", () => {
    expect(shouldAutoPlayMatrixRain(base)).toBe(true)
  })

  test("is opt-in", () => {
    expect(shouldAutoPlayMatrixRain({ ...base, enabled: false })).toBe(false)
  })

  test("never interrupts a dialog, a selection, or an active overlay", () => {
    expect(shouldAutoPlayMatrixRain({ ...base, dialogOpen: true })).toBe(false)
    expect(shouldAutoPlayMatrixRain({ ...base, hasSelection: true })).toBe(false)
    expect(shouldAutoPlayMatrixRain({ ...base, alreadyPlaying: true })).toBe(false)
  })

  test("honors the animation preference and the compiled-runtime policy", () => {
    expect(shouldAutoPlayMatrixRain({ ...base, animationsEnabled: false })).toBe(false)
    expect(shouldAutoPlayMatrixRain({ ...base, runtime: "compiled" })).toBe(false)
  })

  test("stops a playing overlay if a dialog or selection appears", () => {
    expect(shouldStopMatrixRain({ dialogOpen: false, hasSelection: false })).toBe(false)
    expect(shouldStopMatrixRain({ dialogOpen: true, hasSelection: false })).toBe(true)
    expect(shouldStopMatrixRain({ dialogOpen: false, hasSelection: true })).toBe(true)
  })
})
