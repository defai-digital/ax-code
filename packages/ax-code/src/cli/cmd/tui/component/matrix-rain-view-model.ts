import { shouldUseTuiAnimations } from "./spinner-profile"
import type { RuntimeMode } from "@/installation/runtime-mode"

// ASCII-only glyph set. The TUI lays out positioned rows by cell width, and
// East Asian Width "Ambiguous"/"Wide" glyphs (the katakana in the classic
// Matrix effect) break that math. Every code point here is < 0x80.
export const MATRIX_RAIN_GLYPHS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz<>*+=-:.@#$%&"

// The overlay is a short, dismissible flourish: long enough to read as rain,
// short enough to never feel like the terminal has been taken hostage.
export const MATRIX_RAIN_MIN_DURATION_MS = 3_000
export const MATRIX_RAIN_MAX_DURATION_MS = 5_000
export const MATRIX_RAIN_DURATION_MS = 3_500
export const MATRIX_RAIN_TICK_MS = 90

// Rain columns are spaced out rather than one per cell. This keeps the lit
// cell count (and therefore terminal output per frame) proportional to
// height / spacing instead of height * width, which is what makes a full
// screen animation affordable without a bespoke native renderable.
export const MATRIX_RAIN_COLUMN_SPACING = 3
export const MATRIX_RAIN_LEVELS = 4
export const MATRIX_RAIN_MIN_TRAIL = 4
export const MATRIX_RAIN_MAX_TRAIL = 14
export const MATRIX_RAIN_MIN_SPEED = 0.35
export const MATRIX_RAIN_MAX_SPEED = 1.1
export const MATRIX_RAIN_TAIL_MUTATION_CHANCE = 0.35
export const MATRIX_RAIN_RESPAWN_GAP = 20

/** Injectable randomness so frames are deterministic in tests. */
export type MatrixRainRandom = () => number

export interface MatrixRainColumn {
  /** Column x position in cells. */
  x: number
  /** Head row position, tracked as a float; may be negative above the screen. */
  head: number
  /** Rows advanced per tick. */
  speed: number
  /** Trail length in rows. */
  length: number
  /** Glyph per trail offset, index 0 is the head. */
  chars: string[]
}

export interface MatrixRainState {
  width: number
  height: number
  columns: MatrixRainColumn[]
  random: MatrixRainRandom
}

export interface MatrixRainRun {
  text: string
  /** 0 = blank; 1..MATRIX_RAIN_LEVELS = brightness, head is brightest. */
  level: number
}

function between(random: MatrixRainRandom, min: number, max: number): number {
  return min + random() * (max - min)
}

function glyph(random: MatrixRainRandom): string {
  const index = Math.min(MATRIX_RAIN_GLYPHS.length - 1, Math.floor(random() * MATRIX_RAIN_GLYPHS.length))
  return MATRIX_RAIN_GLYPHS[index] ?? " "
}

function makeColumn(random: MatrixRainRandom, x: number, head: number): MatrixRainColumn {
  const length = Math.max(
    MATRIX_RAIN_MIN_TRAIL,
    Math.floor(between(random, MATRIX_RAIN_MIN_TRAIL, MATRIX_RAIN_MAX_TRAIL + 1)),
  )
  return {
    x,
    head,
    speed: between(random, MATRIX_RAIN_MIN_SPEED, MATRIX_RAIN_MAX_SPEED),
    length,
    chars: Array.from({ length }, () => glyph(random)),
  }
}

function columnPositions(width: number): number[] {
  const spacing = MATRIX_RAIN_COLUMN_SPACING
  const count = Math.max(1, Math.floor(width / spacing))
  const span = (count - 1) * spacing
  const offset = Math.max(0, Math.floor((width - span - 1) / 2))
  return Array.from({ length: count }, (_, index) => offset + index * spacing)
}

export function createMatrixRain(input: { width: number; height: number; random?: MatrixRainRandom }): MatrixRainState {
  const width = Math.max(1, Math.floor(input.width))
  const height = Math.max(1, Math.floor(input.height))
  const random = input.random ?? Math.random
  // Stagger initial heads so columns start dropping immediately instead of
  // all entering from the top edge on the same tick.
  const columns = columnPositions(width).map((x) =>
    makeColumn(random, x, between(random, -Math.max(4, height * 0.6), height)),
  )
  return { width, height, columns, random }
}

export function advanceMatrixRain(state: MatrixRainState): MatrixRainState {
  const columns = state.columns.map((column) => {
    const head = column.head + column.speed
    if (head - column.length > state.height) {
      // Column has run off the bottom; restart it above the screen.
      return makeColumn(state.random, column.x, -between(state.random, 1, MATRIX_RAIN_RESPAWN_GAP))
    }
    const chars = column.chars.slice()
    chars[0] = glyph(state.random)
    if (chars.length > 1 && state.random() < MATRIX_RAIN_TAIL_MUTATION_CHANCE) {
      const index = 1 + Math.floor(state.random() * (chars.length - 1))
      chars[index] = glyph(state.random)
    }
    return { ...column, head, chars }
  })
  return { ...state, columns }
}

function levelFor(offset: number, length: number): number {
  const level = MATRIX_RAIN_LEVELS - Math.floor((offset * MATRIX_RAIN_LEVELS) / length)
  return Math.min(MATRIX_RAIN_LEVELS, Math.max(1, level))
}

/**
 * Advance one tick against the current terminal size. A resize rebuilds the
 * columns from scratch rather than rescaling them, so no glyph is ever drawn
 * outside the new width.
 */
export function tickMatrixRain(state: MatrixRainState, size: { width: number; height: number }): MatrixRainState {
  if (state.width !== size.width || state.height !== size.height) {
    return createMatrixRain({ width: size.width, height: size.height, random: state.random })
  }
  return advanceMatrixRain(state)
}

/**
 * Render one frame as per-row color runs. Rows are top-to-bottom; cells with
 * the same brightness are merged into a single run so the renderer emits a
 * bounded number of spans per row.
 */
export function matrixRainRows(state: MatrixRainState): MatrixRainRun[][] {
  const rows: MatrixRainRun[][] = []
  for (let y = 0; y < state.height; y++) {
    const chars: string[] = new Array(state.width).fill(" ")
    const levels = new Array<number>(state.width).fill(0)
    for (const column of state.columns) {
      if (column.x < 0 || column.x >= state.width) continue
      const offset = Math.floor(column.head) - y
      if (offset < 0 || offset >= column.length) continue
      chars[column.x] = column.chars[offset] ?? " "
      levels[column.x] = levelFor(offset, column.length)
    }
    const runs: MatrixRainRun[] = []
    let start = 0
    for (let x = 1; x <= state.width; x++) {
      if (x < state.width && levels[x] === levels[start]) continue
      runs.push({ text: chars.slice(start, x).join(""), level: levels[start] ?? 0 })
      start = x
    }
    rows.push(runs)
  }
  return rows
}

/**
 * Whether a completion event should launch the overlay automatically. The
 * effect is opt-in and never interrupts a dialog, a text selection, or a run
 * that is already on screen.
 */
export function shouldAutoPlayMatrixRain(input: {
  enabled: boolean
  animationsEnabled: boolean
  runtime?: RuntimeMode
  alreadyPlaying: boolean
  dialogOpen: boolean
  hasSelection: boolean
}): boolean {
  if (!input.enabled) return false
  if (input.alreadyPlaying) return false
  if (input.dialogOpen) return false
  if (input.hasSelection) return false
  return shouldUseTuiAnimations({ userEnabled: input.animationsEnabled, runtime: input.runtime })
}

/** Stop a playing overlay if a dialog or selection appears after it started. */
export function shouldStopMatrixRain(input: { dialogOpen: boolean; hasSelection: boolean }): boolean {
  return input.dialogOpen || input.hasSelection
}
