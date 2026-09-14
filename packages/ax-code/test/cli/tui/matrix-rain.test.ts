import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"
import {
  MATRIX_RAIN_COLUMN_SPACING,
  MATRIX_RAIN_DURATION_MS,
  MATRIX_RAIN_GLYPHS,
  MATRIX_RAIN_LEVEL_RGB,
  MATRIX_RAIN_LEVELS,
  MATRIX_RAIN_MAX_DURATION_MS,
  MATRIX_RAIN_MIN_DURATION_MS,
  MATRIX_RAIN_ON_START_DEFAULT,
  STARTUP_LOGO_DROP_DURATION_MS,
  STARTUP_LOGO_DURATION_MS,
  STARTUP_LOGO_HOLD_DURATION_MS,
  STARTUP_LOGO_TICK_MS,
  advanceMatrixRain,
  bindHiddenTerminalCursor,
  completeStartupRain,
  createMatrixRain,
  easeOutLogoDrop,
  initialStartupRainPhase,
  matrixRainRampRgb,
  matrixRainRows,
  resolveStartupRainPhase,
  shouldAutoPlayMatrixRain,
  decideMatrixRainOnStart,
  shouldPlayMatrixRainOnStart,
  shouldStopMatrixRain,
  startupLogoDropLevel,
  startupLogoDropOffset,
  startupLogoDropProgress,
  startupLogoPadding,
  startupRainAfterPlayback,
  startupRainCoversChrome,
  startupRainShowsLogo,
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
  test("splits a short drop plus hold that stays under the rain duration", () => {
    expect(STARTUP_LOGO_DURATION_MS).toBe(STARTUP_LOGO_DROP_DURATION_MS + STARTUP_LOGO_HOLD_DURATION_MS)
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

  test("app plays rain, then the logo, then the working screen", () => {
    const app = readFileSync(path.join(import.meta.dirname, "../../../src/cli/cmd/tui/app.tsx"), "utf8")
    expect(app).toContain("startupRainAfterPlayback")
    expect(app).toContain("startupRainShowsLogo")
    expect(app).toContain("StartupLogo")
  })

  test("the logo overlay hides the terminal cursor while it covers the screen", () => {
    const src = readFileSync(
      path.join(import.meta.dirname, "../../../src/cli/cmd/tui/component/startup-logo.tsx"),
      "utf8",
    )
    expect(src).toContain("bindHiddenTerminalCursor")
  })
})

describe("startup logo drop", () => {
  const LANDING = { contentHeight: 5, terminalHeight: 24 } as const

  test("emerges from fully above the top edge and lands centered", () => {
    expect(startupLogoDropOffset({ ...LANDING, progress: 0 })).toBe(-LANDING.contentHeight)
    expect(startupLogoDropOffset({ ...LANDING, progress: 1 })).toBe(9)
  })

  test("falls monotonically and never travels past the landing", () => {
    let previous = Number.NEGATIVE_INFINITY
    for (let step = 0; step <= 20; step++) {
      const offset = startupLogoDropOffset({ ...LANDING, progress: step / 20 })
      expect(offset).toBeGreaterThanOrEqual(previous)
      expect(offset).toBeGreaterThanOrEqual(-LANDING.contentHeight)
      expect(offset).toBeLessThanOrEqual(9)
      previous = offset
    }
  })

  test("eases out so most of the drop is covered early", () => {
    expect(easeOutLogoDrop(0.5)).toBeCloseTo(0.875, 10)
    const halfway = startupLogoDropOffset({ ...LANDING, progress: 0.5 })
    expect(halfway).toBeGreaterThan(4)
    expect(halfway).toBeLessThan(9)
  })

  test("clamps progress outside the drop window", () => {
    expect(startupLogoDropProgress(-100)).toBe(0)
    expect(startupLogoDropProgress(0)).toBe(0)
    expect(startupLogoDropProgress(STARTUP_LOGO_DROP_DURATION_MS * 2)).toBe(1)
    expect(startupLogoDropOffset({ ...LANDING, progress: -1 })).toBe(-LANDING.contentHeight)
    expect(startupLogoDropOffset({ ...LANDING, progress: 5 })).toBe(9)
  })

  test("lands at row zero when the terminal is shorter than the logo", () => {
    expect(startupLogoDropOffset({ progress: 1, contentHeight: 12, terminalHeight: 8 })).toBe(0)
    expect(startupLogoDropOffset({ progress: 0, contentHeight: 12, terminalHeight: 8 })).toBe(-12)
  })

  test("uses a tick short enough to read as motion", () => {
    expect(STARTUP_LOGO_TICK_MS).toBeGreaterThan(0)
    expect(STARTUP_LOGO_TICK_MS).toBeLessThan(STARTUP_LOGO_DROP_DURATION_MS / 5)
  })

  test("the overlay animates the offset instead of a fixed padding", () => {
    const src = readFileSync(
      path.join(import.meta.dirname, "../../../src/cli/cmd/tui/component/startup-logo.tsx"),
      "utf8",
    )
    expect(src).toContain("startupLogoDropOffset")
    expect(src).toContain("scheduleTuiInterval")
    expect(src).toContain('overflow="hidden"')
  })
})

describe("startup logo color", () => {
  test("shares the rain brightness ramp", () => {
    expect(MATRIX_RAIN_LEVEL_RGB.length).toBe(MATRIX_RAIN_LEVELS + 1)
    expect(matrixRainRampRgb(0)).toEqual([0, 0, 0])
    expect(matrixRainRampRgb(MATRIX_RAIN_LEVELS)).toEqual([205, 255, 220])
  })

  test("returns table entries exactly at integer levels", () => {
    for (let level = 0; level <= MATRIX_RAIN_LEVELS; level++) {
      expect(matrixRainRampRgb(level)).toEqual([...MATRIX_RAIN_LEVEL_RGB[level]])
    }
  })

  test("interpolates fractional levels and clamps out-of-range ones", () => {
    expect(matrixRainRampRgb(1.5)).toEqual([0, 115, 13])
    expect(matrixRainRampRgb(-5)).toEqual([0, 0, 0])
    expect(matrixRainRampRgb(99)).toEqual([205, 255, 220])
  })

  test("the mark starts green and lands on the white head", () => {
    expect(startupLogoDropLevel(0)).toBe(1)
    expect(startupLogoDropLevel(1)).toBe(MATRIX_RAIN_LEVELS)
    expect(matrixRainRampRgb(startupLogoDropLevel(0))).toEqual(matrixRainRampRgb(1))
    expect(matrixRainRampRgb(startupLogoDropLevel(1))).toEqual(matrixRainRampRgb(MATRIX_RAIN_LEVELS))
  })

  test("brightens monotonically as it drops", () => {
    let previous = Number.NEGATIVE_INFINITY
    for (let step = 0; step <= 10; step++) {
      const level = startupLogoDropLevel(step / 10)
      expect(level).toBeGreaterThanOrEqual(previous)
      previous = level
    }
  })

  test("both overlays read the one shared ramp", () => {
    const dir = "../../../src/cli/cmd/tui/component"
    const rain = readFileSync(path.join(import.meta.dirname, dir, "matrix-rain.tsx"), "utf8")
    const logo = readFileSync(path.join(import.meta.dirname, dir, "startup-logo.tsx"), "utf8")
    expect(rain).toContain("MATRIX_RAIN_LEVEL_RGB")
    expect(logo).toContain("matrixRainRampRgb")
    expect(logo).toContain("startupLogoDropLevel")
  })
})
