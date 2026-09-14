import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"
import {
  MATRIX_RAIN_COLUMN_SPACING,
  MATRIX_RAIN_DURATION_MS,
  MATRIX_RAIN_GLYPHS,
  MATRIX_RAIN_HEAVY_GLYPHS,
  MATRIX_RAIN_LIGHT_GLYPHS,
  MATRIX_RAIN_LEVEL_RGB,
  MATRIX_RAIN_LEVELS,
  MATRIX_RAIN_MAX_DURATION_MS,
  MATRIX_RAIN_MIN_DURATION_MS,
  MATRIX_RAIN_ON_START_DEFAULT,
  MATRIX_RAIN_RESPAWN_GAP,
  MATRIX_RAIN_REVERSE_DURATION_MS,
  STARTUP_LOGO_DURATION_MS,
  STARTUP_LOGO_FALL_DURATION_MS,
  STARTUP_LOGO_FALL_JITTER_MS,
  STARTUP_LOGO_HOLD_DURATION_MS,
  STARTUP_LOGO_STAGGER_MS,
  STARTUP_LOGO_TICK_MS,
  advanceMatrixRain,
  bindHiddenTerminalCursor,
  completeStartupRain,
  createMatrixRain,
  createStartupLogoGlyphs,
  easeOutLogoDrop,
  initialStartupRainPhase,
  matrixRainCellLevel,
  matrixRainRows,
  resolveStartupRainPhase,
  shouldAutoPlayMatrixRain,
  decideMatrixRainOnStart,
  shouldPlayMatrixRainOnStart,
  shouldPlayExitMatrixRain,
  shouldStopMatrixRain,
  startupLogoDropLevel,
  startupLogoFrame,
  startupLogoGlyphLevel,
  startupLogoGlyphProgress,
  startupLogoGlyphRow,
  startupLogoPadding,
  startupRainAfterPlayback,
  startupRainCoversChrome,
  startupRainShowsLogo,
  tickMatrixRain,
} from "../../../src/cli/cmd/tui/component/matrix-rain-view-model"
import type { MatrixRainRun, MatrixRainState } from "../../../src/cli/cmd/tui/component/matrix-rain-view-model"
import { logo } from "../../../src/cli/logo"

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

/**
 * Every rendered row must stay inside the design budget: a column lights at most
 * one cell per row, so a row has at most `columns` lit cells and at most two
 * runs per lit cell (the blank run on either side). Asserting `columns + 1`
 * instead would be wrong — a row with several lit columns legitimately has more
 * runs than that, and that false bound used to pass only for one lucky seed.
 */
function expectRowBudget(state: MatrixRainState, rows: MatrixRainRun[][]): void {
  for (const row of rows) {
    const lit = row.reduce((total, run) => total + (run.level > 0 ? run.text.length : 0), 0)
    expect(lit).toBeLessThanOrEqual(state.columns.length)
    expect(row.length).toBeLessThanOrEqual(2 * state.columns.length + 1)
  }
}

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

  test("merges adjacent cells sharing brightness and weight into single runs", () => {
    const state = createMatrixRain({ ...GRID, random: seeded(3) })
    const rows = matrixRainRows(state)
    for (const run of rows[Math.floor(GRID.height / 2)] ?? []) {
      expect(run.text.length).toBeGreaterThan(0)
    }
    for (const row of rows) {
      for (let i = 1; i < row.length; i++) {
        expect([row[i]!.level, row[i]!.bold]).not.toEqual([row[i - 1]!.level, row[i - 1]!.bold])
      }
    }
    // Spacing columns is what keeps the per-frame span count proportional to the
    // column count rather than to the terminal width.
    expectRowBudget(state, rows)
  })

  test("keeps one column per lane so the lit cell count stays bounded", () => {
    const state = createMatrixRain({ ...GRID, random: seeded(11) })
    const xs = state.columns.map((column) => column.x)
    expect(xs.length).toBe(Math.floor(GRID.width / MATRIX_RAIN_COLUMN_SPACING))
    for (let i = 0; i < xs.length; i++) {
      expect(xs[i]!).toBeGreaterThanOrEqual(0)
      expect(xs[i]!).toBeLessThan(GRID.width)
      // Lanes never overlap, so jitter cannot make two columns collide or swap.
      if (i > 0) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!)
    }
  })

  test("jitters each column inside its own lane", () => {
    const state = createMatrixRain({ ...GRID, random: seeded(23) })
    const spacing = MATRIX_RAIN_COLUMN_SPACING
    const count = Math.floor(GRID.width / spacing)
    const span = (count - 1) * spacing
    const offset = Math.max(0, Math.floor((GRID.width - span - 1) / 2))
    const jitters = state.columns.map((column, index) => column.x - offset - index * spacing)
    for (const jitter of jitters) {
      expect(jitter).toBeGreaterThanOrEqual(0)
      expect(jitter).toBeLessThan(spacing)
    }
    // One shared offset would still read as a grid, so the jitter must vary.
    expect(new Set(jitters).size).toBeGreaterThan(1)
  })

  test("is deterministic for a fixed random source", () => {
    const first = matrixRainRows(createMatrixRain({ ...GRID, random: seeded(42) }))
    const second = matrixRainRows(createMatrixRain({ ...GRID, random: seeded(42) }))
    expect(second).toEqual(first)
  })
})

describe("overlay yields to a selection", () => {
  test("a live selection stops the overlay even without a dialog", () => {
    expect(shouldStopMatrixRain({ dialogOpen: false, hasSelection: false })).toBe(false)
    expect(shouldStopMatrixRain({ dialogOpen: false, hasSelection: true })).toBe(true)
    expect(shouldStopMatrixRain({ dialogOpen: true, hasSelection: false })).toBe(true)
  })

  test("both overlays yield when the renderer reports a selection", () => {
    const dir = "../../../src/cli/cmd/tui/component"
    expect(readFileSync(path.join(import.meta.dirname, dir, "matrix-rain.tsx"), "utf8")).toContain(
      "renderer.hasSelection",
    )
    expect(readFileSync(path.join(import.meta.dirname, dir, "startup-logo.tsx"), "utf8")).toContain(
      "renderer.hasSelection",
    )
  })
})

describe("matrix rain column weight", () => {
  test("splits the glyph set into disjoint ASCII pools", () => {
    expect(MATRIX_RAIN_HEAVY_GLYPHS.length).toBeGreaterThan(0)
    expect(MATRIX_RAIN_LIGHT_GLYPHS.length).toBeGreaterThan(0)
    expect(MATRIX_RAIN_GLYPHS).toBe(MATRIX_RAIN_HEAVY_GLYPHS + MATRIX_RAIN_LIGHT_GLYPHS)
    const heavy = new Set(MATRIX_RAIN_HEAVY_GLYPHS)
    for (const char of MATRIX_RAIN_LIGHT_GLYPHS) expect(heavy.has(char)).toBe(false)
    for (const char of MATRIX_RAIN_GLYPHS) expect(char.codePointAt(0)).toBeLessThan(0x80)
  })

  test("gives some columns each weight", () => {
    const state = createMatrixRain({ ...GRID, random: seeded(31) })
    expect(new Set(state.columns.map((column) => column.heavy))).toEqual(new Set([true, false]))
  })

  test("keeps every column inside its own pool for its whole life", () => {
    let state = createMatrixRain({ ...GRID, random: seeded(37) })
    for (let tick = 0; tick < 200; tick++) {
      for (const column of state.columns) {
        const pool = column.heavy ? MATRIX_RAIN_HEAVY_GLYPHS : MATRIX_RAIN_LIGHT_GLYPHS
        for (const char of column.chars) expect(pool).toContain(char)
      }
      state = advanceMatrixRain(state)
    }
  })

  test("marks only cells of heavy columns bold", () => {
    let state = createMatrixRain({ ...GRID, random: seeded(41) })
    let sawBold = false
    for (let tick = 0; tick < 60; tick++) {
      for (const row of matrixRainRows(state)) {
        for (const run of row) {
          if (!run.bold) continue
          sawBold = true
          for (const char of run.text) expect(MATRIX_RAIN_HEAVY_GLYPHS).toContain(char)
        }
      }
      state = advanceMatrixRain(state)
    }
    expect(sawBold).toBe(true)
  })

  test("keeps every row inside the lit-cell budget over time", () => {
    // These seeds are the ones whose dense rows exceed `columns + 1` runs, so the
    // test proves the corrected bound instead of passing on a sparse frame.
    for (const seed of [42, 43, 48]) {
      let state = createMatrixRain({ ...GRID, random: seeded(seed) })
      for (let tick = 0; tick < 60; tick++) {
        expectRowBudget(state, matrixRainRows(state))
        state = advanceMatrixRain(state)
      }
    }
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
  test("stays inside the requested 2.5 to 5 second window", () => {
    expect(MATRIX_RAIN_MIN_DURATION_MS).toBeGreaterThanOrEqual(2_500)
    expect(MATRIX_RAIN_MAX_DURATION_MS).toBeLessThanOrEqual(5_000)
    expect(MATRIX_RAIN_DURATION_MS).toBe(2_500)
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

describe("matrix rain cursor hide", () => {
  test("hides the terminal cursor after each frame and restores on unbind", () => {
    const calls: Array<{ kind: string; args: unknown[] }> = []
    const post: Array<(buffer: unknown, deltaTime: number) => void> = []
    const renderer = {
      setCursorPosition(x: number, y: number, visible?: boolean) {
        calls.push({ kind: "cursor", args: [x, y, visible] })
      },
      addPostProcessFn(fn: (buffer: unknown, deltaTime: number) => void) {
        post.push(fn)
      },
      removePostProcessFn(fn: (buffer: unknown, deltaTime: number) => void) {
        const index = post.indexOf(fn)
        if (index >= 0) post.splice(index, 1)
      },
      requestRender() {
        calls.push({ kind: "render", args: [] })
      },
    }

    const unbind = bindHiddenTerminalCursor(renderer)
    expect(calls).toEqual([
      { kind: "cursor", args: [0, 0, false] },
      { kind: "render", args: [] },
    ])
    expect(post).toHaveLength(1)

    calls.length = 0
    post[0]?.({}, 16)
    expect(calls).toEqual([{ kind: "cursor", args: [0, 0, false] }])

    calls.length = 0
    unbind()
    expect(post).toHaveLength(0)
    expect(calls).toEqual([{ kind: "render", args: [] }])
  })

  test("both overlays hide the cursor while they cover the screen", () => {
    const src = readFileSync(
      path.join(import.meta.dirname, "../../../src/cli/cmd/tui/component/matrix-rain.tsx"),
      "utf8",
    )
    expect(src).toContain("bindHiddenTerminalCursor")
    expect(src.match(/^\s+useHiddenTerminalCursor\(\)$/gm)?.length).toBe(2)
  })
})

describe("matrix rain startup gate", () => {
  const base = { enabled: true, animationsEnabled: true, runtime: "source" as const }

  test("defaults to on so startup plays without configuration", () => {
    expect(MATRIX_RAIN_ON_START_DEFAULT).toBe(true)
    expect(shouldPlayMatrixRainOnStart({ ...base, enabled: MATRIX_RAIN_ON_START_DEFAULT })).toBe(true)
  })

  test("stays off when the user opts out", () => {
    expect(shouldPlayMatrixRainOnStart({ ...base, enabled: false })).toBe(false)
  })

  test("honors the animation preference and the compiled-runtime policy", () => {
    expect(shouldPlayMatrixRainOnStart({ ...base, animationsEnabled: false })).toBe(false)
    expect(shouldPlayMatrixRainOnStart({ ...base, runtime: "compiled" })).toBe(false)
    expect(shouldPlayMatrixRainOnStart({ ...base, runtime: "node-bundled" })).toBe(true)
  })

  test("App waits for kv.ready before deciding startup rain", () => {
    const app = readFileSync(path.join(import.meta.dirname, "../../../src/cli/cmd/tui/app.tsx"), "utf8")
    expect(app).toContain("resolveStartupRainPhase")
    expect(app).toContain("initialStartupRainPhase")
    expect(app).toContain("MatrixRainCover")
    expect(app).toContain("() => kv.ready")
    expect(app).not.toMatch(/onMount\(\(\) => \{\s*if \(\s*shouldPlayMatrixRainOnStart/)
  })

  test("does not play until kv is ready, then honors a persisted opt-out", () => {
    expect(
      decideMatrixRainOnStart({
        ready: false,
        enabled: MATRIX_RAIN_ON_START_DEFAULT,
        animationsEnabled: true,
        runtime: "source",
      }),
    ).toBe(false)
    expect(
      decideMatrixRainOnStart({
        ready: true,
        enabled: false,
        animationsEnabled: true,
        runtime: "source",
      }),
    ).toBe(false)
    expect(
      decideMatrixRainOnStart({
        ready: true,
        enabled: true,
        animationsEnabled: true,
        runtime: "source",
      }),
    ).toBe(true)
  })
})

describe("startup rain chrome cover", () => {
  const hold = {
    phase: "hold" as const,
    ready: false,
    enabled: true,
    animationsEnabled: true,
    runtime: "source" as const,
    dialogOpen: false,
  }

  test("covers the main screen until kv can honor a persisted opt-out", () => {
    expect(initialStartupRainPhase("source")).toBe("hold")
    expect(initialStartupRainPhase("node-bundled")).toBe("hold")
    expect(initialStartupRainPhase("compiled")).toBe("app")
    expect(startupRainCoversChrome("hold")).toBe(true)
    expect(startupRainCoversChrome("rain")).toBe(true)
    expect(startupRainCoversChrome("logo")).toBe(true)
    expect(startupRainCoversChrome("app")).toBe(false)
  })

  test("stays covered while kv is loading, then plays or reveals", () => {
    expect(resolveStartupRainPhase(hold)).toBe("hold")
    expect(resolveStartupRainPhase({ ...hold, ready: true })).toBe("rain")
    expect(resolveStartupRainPhase({ ...hold, ready: true, enabled: false })).toBe("app")
    expect(resolveStartupRainPhase({ ...hold, ready: true, animationsEnabled: false })).toBe("app")
    expect(resolveStartupRainPhase({ ...hold, ready: true, runtime: "compiled" })).toBe("app")
  })

  test("drops the cover for a dialog and after the overlay finishes", () => {
    expect(resolveStartupRainPhase({ ...hold, dialogOpen: true })).toBe("app")
    expect(resolveStartupRainPhase({ ...hold, phase: "rain", ready: true })).toBe("rain")
    expect(resolveStartupRainPhase({ ...hold, phase: "rain", ready: true, dialogOpen: true })).toBe("app")
    expect(resolveStartupRainPhase({ ...hold, phase: "logo", ready: true })).toBe("logo")
    expect(resolveStartupRainPhase({ ...hold, phase: "logo", ready: true, dialogOpen: true })).toBe("app")
    expect(resolveStartupRainPhase({ ...hold, phase: "app", ready: true })).toBe("app")
    expect(completeStartupRain()).toBe("app")
    expect(startupRainAfterPlayback()).toBe("logo")
    expect(startupRainShowsLogo("logo")).toBe(true)
    expect(startupRainShowsLogo("rain")).toBe(false)
    expect(startupRainShowsLogo("app")).toBe(false)
  })
})

describe("startup logo beat", () => {
  test("app plays rain, then the logo, then the working screen", () => {
    const app = readFileSync(path.join(import.meta.dirname, "../../../src/cli/cmd/tui/app.tsx"), "utf8")
    expect(app).toContain("startupRainAfterPlayback")
    expect(app).toContain("startupRainShowsLogo")
    expect(app).toContain("StartupLogo")
  })

  test("the logo overlay hides the cursor and clips the drop", () => {
    const src = readFileSync(
      path.join(import.meta.dirname, "../../../src/cli/cmd/tui/component/startup-logo.tsx"),
      "utf8",
    )
    expect(src).toContain("bindHiddenTerminalCursor")
    expect(src).toContain('overflow="hidden"')
  })
})

describe("startup logo drop", () => {
  test("splits the intro into stagger, fall, jitter and hold", () => {
    expect(STARTUP_LOGO_DURATION_MS).toBe(
      STARTUP_LOGO_STAGGER_MS +
        STARTUP_LOGO_FALL_DURATION_MS +
        STARTUP_LOGO_FALL_JITTER_MS +
        STARTUP_LOGO_HOLD_DURATION_MS,
    )
    expect(STARTUP_LOGO_HOLD_DURATION_MS).toBeGreaterThan(0)
    expect(STARTUP_LOGO_DURATION_MS).toBeLessThan(MATRIX_RAIN_MIN_DURATION_MS)
  })

  test("centers the logo block, flooring an odd gap", () => {
    expect(startupLogoPadding({ contentWidth: 53, contentHeight: 5, width: 80, height: 24 })).toEqual({
      paddingTop: 9,
      paddingLeft: 13,
    })
  })

  test("clamps to zero in a terminal smaller than the logo", () => {
    expect(startupLogoPadding({ contentWidth: 53, contentHeight: 5, width: 40, height: 3 })).toEqual({
      paddingTop: 0,
      paddingLeft: 0,
    })
  })

  test("uses a tick short enough to read as motion", () => {
    expect(STARTUP_LOGO_TICK_MS).toBeGreaterThan(0)
    expect(STARTUP_LOGO_TICK_MS).toBeLessThan(STARTUP_LOGO_FALL_DURATION_MS / 5)
  })

  test("builds one glyph per visible character, ignoring padding", () => {
    const glyphs = createStartupLogoGlyphs({ lines: ["AB C   ", " D  "], random: () => 0.5 })
    expect(glyphs.map((glyph) => glyph.char)).toEqual(["A", "B", "C", "D"])
    expect(glyphs.map((glyph) => [glyph.row, glyph.col])).toEqual([
      [0, 0],
      [0, 1],
      [0, 3],
      [1, 1],
    ])
  })

  test("randomizes start order and speed across characters", () => {
    let seed = 1
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    const glyphs = createStartupLogoGlyphs({ lines: ["ABCDEFGH", "IJKLMNOP"], random })
    expect(new Set(glyphs.map((glyph) => glyph.delayMs)).size).toBeGreaterThan(1)
    expect(new Set(glyphs.map((glyph) => glyph.fallMs)).size).toBeGreaterThan(1)
    for (const glyph of glyphs) {
      expect(glyph.delayMs).toBeGreaterThanOrEqual(0)
      expect(glyph.delayMs).toBeLessThanOrEqual(STARTUP_LOGO_STAGGER_MS)
      expect(glyph.fallMs).toBeGreaterThanOrEqual(STARTUP_LOGO_FALL_DURATION_MS)
      expect(glyph.fallMs).toBeLessThanOrEqual(STARTUP_LOGO_FALL_DURATION_MS + STARTUP_LOGO_FALL_JITTER_MS)
    }
  })

  test("starts above the top edge and lands on its resting row", () => {
    const glyph = { char: "A", row: 0, col: 0, delayMs: 0, fallMs: STARTUP_LOGO_FALL_DURATION_MS }
    expect(startupLogoGlyphRow({ glyph, elapsedMs: 0, blockTop: 9 })).toBe(-1)
    expect(startupLogoGlyphRow({ glyph, elapsedMs: STARTUP_LOGO_DURATION_MS, blockTop: 9 })).toBe(9)
  })

  test("waits out its own delay before moving", () => {
    const glyph = { char: "A", row: 0, col: 0, delayMs: 100, fallMs: 200 }
    expect(startupLogoGlyphProgress(glyph, 100)).toBe(0)
    expect(startupLogoGlyphProgress(glyph, 200)).toBeCloseTo(0.5, 10)
    expect(startupLogoGlyphProgress(glyph, 300)).toBe(1)
  })

  test("descends monotonically and never travels past its row", () => {
    const glyph = { char: "A", row: 2, col: 0, delayMs: 40, fallMs: 300 }
    let previous = Number.NEGATIVE_INFINITY
    for (let elapsed = 0; elapsed <= STARTUP_LOGO_DURATION_MS; elapsed += 20) {
      const row = startupLogoGlyphRow({ glyph, elapsedMs: elapsed, blockTop: 9 })
      expect(row).toBeGreaterThanOrEqual(previous)
      expect(row).toBeLessThanOrEqual(11)
      previous = row
    }
  })

  test("draws nothing while the mark is still above the screen", () => {
    const glyphs = createStartupLogoGlyphs({ lines: ["AB", "CD"], random: () => 0 })
    const early = startupLogoFrame({ glyphs, elapsedMs: 0, blockLeft: 0, blockTop: 2, width: 20, height: 10 })
    expect(early.rows).toHaveLength(0)
  })

  test("lands every character on its own row", () => {
    const glyphs = createStartupLogoGlyphs({ lines: ["AB", "CD"], random: () => 0 })
    const landed = startupLogoFrame({
      glyphs,
      elapsedMs: STARTUP_LOGO_DURATION_MS,
      blockLeft: 0,
      blockTop: 2,
      width: 20,
      height: 10,
    })
    expect(landed.top).toBe(2)
    expect(landed.rows).toHaveLength(2)
    expect(
      landed.rows[0]
        .map((run) => run.text)
        .join("")
        .trimEnd(),
    ).toBe("AB")
    expect(
      landed.rows[1]
        .map((run) => run.text)
        .join("")
        .trimEnd(),
    ).toBe("CD")
  })

  test("lands the exact mark once the drop settles", () => {
    const glyphs = createStartupLogoGlyphs({ lines: logo, random: () => 0.3 })
    const frame = startupLogoFrame({
      glyphs,
      elapsedMs: STARTUP_LOGO_DURATION_MS,
      blockLeft: 13,
      blockTop: 9,
      width: 80,
      height: 24,
    })
    const rendered = frame.rows.map((row) =>
      row
        .map((run) => run.text)
        .join("")
        .slice(13)
        .trimEnd(),
    )
    expect(frame.top).toBe(9)
    expect(rendered).toEqual(logo.map((line) => line.trimEnd()))
  })

  test("keeps every frame inside the terminal and ASCII-only", () => {
    const glyphs = createStartupLogoGlyphs({ lines: logo, random: () => 0.4 })
    for (let elapsed = 0; elapsed <= STARTUP_LOGO_DURATION_MS; elapsed += STARTUP_LOGO_TICK_MS) {
      const frame = startupLogoFrame({ glyphs, elapsedMs: elapsed, blockLeft: 13, blockTop: 9, width: 80, height: 24 })
      expect(frame.top).toBeGreaterThanOrEqual(0)
      expect(frame.top + frame.rows.length).toBeLessThanOrEqual(24)
      for (const row of frame.rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(80)
        expect(text).toMatch(/^[ -~]*$/)
      }
    }
  })
})

describe("startup logo color", () => {
  test("shares the rain brightness ramp", () => {
    expect(MATRIX_RAIN_LEVEL_RGB.length).toBe(MATRIX_RAIN_LEVELS + 1)
    expect(MATRIX_RAIN_LEVEL_RGB[0]).toEqual([0, 0, 0])
    expect(MATRIX_RAIN_LEVEL_RGB[MATRIX_RAIN_LEVELS]).toEqual([205, 255, 220])
  })

  test("maps fall progress onto the ramp", () => {
    expect(startupLogoDropLevel(0)).toBe(1)
    expect(startupLogoDropLevel(0.5)).toBe(2.5)
    expect(startupLogoDropLevel(1)).toBe(MATRIX_RAIN_LEVELS)
  })

  test("each character warms from green to the white head as it lands", () => {
    const glyph = { char: "A", row: 0, col: 0, delayMs: 0, fallMs: 200 }
    expect(Math.round(startupLogoGlyphLevel(glyph, 0))).toBe(1)
    expect(Math.round(startupLogoGlyphLevel(glyph, 200))).toBe(MATRIX_RAIN_LEVELS)
  })

  test("both overlays colorize from the one shared ramp", () => {
    const dir = "../../../src/cli/cmd/tui/component"
    const palette = readFileSync(path.join(import.meta.dirname, dir, "matrix-rain-palette.ts"), "utf8")
    const rain = readFileSync(path.join(import.meta.dirname, dir, "matrix-rain.tsx"), "utf8")
    const logoOverlay = readFileSync(path.join(import.meta.dirname, dir, "startup-logo.tsx"), "utf8")
    expect(palette).toContain("MATRIX_RAIN_LEVEL_RGB")
    expect(rain).toContain("MATRIX_RAIN_LEVEL_COLORS")
    expect(logoOverlay).toContain("MATRIX_RAIN_LEVEL_COLORS")
  })
})

describe("reverse exit rain", () => {
  test("plays for the requested three seconds", () => {
    expect(MATRIX_RAIN_REVERSE_DURATION_MS).toBe(3_000)
  })

  test("defaults to the startup fall", () => {
    expect(createMatrixRain({ ...GRID, random: seeded(1) }).direction).toBe("down")
  })

  test("rises a column head by its own speed", () => {
    const state = createMatrixRain({ ...GRID, random: seeded(5), direction: "up" })
    const before = state.columns[0]!
    const next = advanceMatrixRain(state)
    const after = next.columns[0]!
    expect(after.head).toBeCloseTo(before.head - before.speed, 10)
    expect(next.direction).toBe("up")
  })

  test("starts every column at or below the top edge", () => {
    const state = createMatrixRain({ ...GRID, random: seeded(29), direction: "up" })
    expect(state.columns.every((column) => column.head >= 0)).toBe(true)
  })

  test("trails below a rising head, green at the top and white at the bottom", () => {
    const up: MatrixRainState = {
      width: 3,
      height: 9,
      direction: "up",
      random: () => 0,
      columns: [{ x: 1, head: 4, speed: 0.5, length: 4, chars: ["A", "B", "C", "D"], heavy: false }],
    }
    const down: MatrixRainState = { ...up, direction: "down" }
    const lit = (state: MatrixRainState, y: number) => matrixRainRows(state)[y]!.filter((run) => run.level > 0)

    // Reverse rain: the leading cell is at row 4 and the trail falls below it.
    expect(lit(up, 4)[0]?.text).toBe("A")
    expect(lit(up, 5)[0]?.text).toBe("B")
    expect(lit(up, 6)[0]?.text).toBe("C")
    expect(lit(up, 7)[0]?.text).toBe("D")
    expect(lit(up, 3)).toHaveLength(0)
    expect(lit(up, 8)).toHaveLength(0)

    // Green at the top of the streak, white at the bottom: brightness grows
    // downward, the opposite of the falling rain's white head / green tail.
    expect(lit(up, 4)[0]!.level).toBe(1)
    expect(lit(up, 7)[0]!.level).toBe(MATRIX_RAIN_LEVELS)
    expect(lit(up, 4)[0]!.level).toBeLessThan(lit(up, 5)[0]!.level)
    expect(lit(up, 5)[0]!.level).toBeLessThan(lit(up, 6)[0]!.level)
    expect(lit(up, 6)[0]!.level).toBeLessThan(lit(up, 7)[0]!.level)

    // The startup rain is the same streak mirrored: white head, green above.
    expect(lit(down, 4)[0]?.text).toBe("A")
    expect(lit(down, 3)[0]?.text).toBe("B")
    expect(lit(down, 2)[0]?.text).toBe("C")
    expect(lit(down, 1)[0]?.text).toBe("D")
    expect(lit(down, 4)[0]!.level).toBe(MATRIX_RAIN_LEVELS)
    expect(lit(down, 1)[0]!.level).toBe(1)
  })

  test("inverts the brightness ramp for the reverse rain", () => {
    const length = 4
    expect(matrixRainCellLevel("down", 0, length)).toBe(MATRIX_RAIN_LEVELS)
    expect(matrixRainCellLevel("down", length - 1, length)).toBe(1)
    expect(matrixRainCellLevel("up", 0, length)).toBe(1)
    expect(matrixRainCellLevel("up", length - 1, length)).toBe(MATRIX_RAIN_LEVELS)
    // Both ramps stay inside the shared brightness range at every offset of a
    // real trail length.
    for (let offset = 0; offset < 14; offset++) {
      for (const direction of ["down", "up"] as const) {
        const level = matrixRainCellLevel(direction, offset, 14)
        expect(level).toBeGreaterThanOrEqual(1)
        expect(level).toBeLessThanOrEqual(MATRIX_RAIN_LEVELS)
      }
    }
  })

  test("recycles columns at the top and keeps every frame valid", () => {
    let state = createMatrixRain({ width: 40, height: 10, random: seeded(9), direction: "up" })
    for (let tick = 0; tick < 400; tick++) {
      state = advanceMatrixRain(state)
      const rows = matrixRainRows(state)
      expect(rows).toHaveLength(10)
      for (const row of rows) {
        expect(row.map((run) => run.text).join("")).toHaveLength(40)
      }
      // A respawned column re-enters from below the bottom edge, never from
      // above the top one.
      for (const column of state.columns) {
        expect(column.head).toBeLessThanOrEqual(state.height + MATRIX_RAIN_RESPAWN_GAP)
      }
    }
  })

  test("preserves the direction across a resize", () => {
    const state = createMatrixRain({ ...GRID, random: seeded(19), direction: "up" })
    const resized = tickMatrixRain(state, { width: 40, height: 12 })
    expect(resized.direction).toBe("up")
    expect(resized.columns.every((column) => column.head >= 0)).toBe(true)
  })

  test("honors the animation preference and the compiled runtime", () => {
    expect(shouldPlayExitMatrixRain({ animationsEnabled: true, runtime: "source" })).toBe(true)
    expect(shouldPlayExitMatrixRain({ animationsEnabled: true, runtime: "node-bundled" })).toBe(true)
    expect(shouldPlayExitMatrixRain({ animationsEnabled: false, runtime: "source" })).toBe(false)
    expect(shouldPlayExitMatrixRain({ animationsEnabled: true, runtime: "compiled" })).toBe(false)
  })

  test("the app plays the reverse rain before an explicit exit tears down", () => {
    const dir = "../../../src/cli/cmd/tui"
    const app = readFileSync(path.join(import.meta.dirname, dir, "app.tsx"), "utf8")
    expect(app).toContain("MATRIX_RAIN_REVERSE_DURATION_MS")
    expect(app).toContain('direction="up"')
    expect(app).toContain("exit.onFlourish")
    // One shared run: a quit that lands while the video is already on screen
    // waits for it instead of tearing the renderer down mid-animation.
    expect(app).toContain("if (existing) return existing")
    expect(readFileSync(path.join(import.meta.dirname, dir, "context/exit.tsx"), "utf8")).toContain("onFlourish")
  })

  test("typed exit and the /exit command request the flourish", () => {
    const dir = "../../../src/cli/cmd/tui"
    expect(readFileSync(path.join(import.meta.dirname, dir, "component/prompt/index.tsx"), "utf8")).toContain(
      "exit.flourish",
    )
    const commands = readFileSync(path.join(import.meta.dirname, dir, "app-commands.ts"), "utf8")
    expect(commands).toContain("exit.flourish")
    // `/exit` is offered in the slash menu, not merely callable blind.
    expect(commands).toMatch(/name: "exit",\s*aliases: \["quit", "q"\],\s*\},/)
    expect(commands).not.toMatch(/name: "exit",\s*aliases: \[[^\]]*\],\s*hidden: true/)
  })

  test("the palette previews the reverse rain alongside the rain", () => {
    const dir = "../../../src/cli/cmd/tui"
    const commands = readFileSync(path.join(import.meta.dirname, dir, "app-commands.ts"), "utf8")
    expect(commands).toContain('value: "app.matrix.play_reverse"')
    expect(commands).toContain("playReverseMatrixRain()")
    expect(readFileSync(path.join(import.meta.dirname, dir, "app.tsx"), "utf8")).toContain("playReverseMatrixRain,")
  })

  test("the palette uses the video wording", () => {
    const commands = readFileSync(path.join(import.meta.dirname, "../../../src/cli/cmd/tui/app-commands.ts"), "utf8")
    expect(commands).toContain("Play Opening Video")
    expect(commands).toContain("Play Ending Video")
    expect(commands).toContain("Enable OV/EV on task completion")
    expect(commands).toContain("Disable OV/EV on task completion")
  })

  test("ctrl+c plays the ending video before the app ends", () => {
    const dir = "../../../src/cli/cmd/tui"
    expect(readFileSync(path.join(import.meta.dirname, dir, "component/prompt/index.tsx"), "utf8")).toContain(
      "await exit.flourish()",
    )
    expect(readFileSync(path.join(import.meta.dirname, dir, "routes/session/index.tsx"), "utf8")).toContain(
      "exit.flourish()",
    )
  })
})
