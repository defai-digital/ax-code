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

// Startup sequence: rain -> logo drop -> app. Every character of the mark
// falls on its own schedule: a random stagger delay decides who leaves first
// and a small speed jitter stops the fall looking uniform, so the word
// assembles out of the rain instead of sliding down as one block.
export const STARTUP_LOGO_FALL_DURATION_MS = 350
export const STARTUP_LOGO_FALL_JITTER_MS = 120
export const STARTUP_LOGO_STAGGER_MS = 300
export const STARTUP_LOGO_HOLD_DURATION_MS = 260
export const STARTUP_LOGO_DURATION_MS =
  STARTUP_LOGO_STAGGER_MS + STARTUP_LOGO_FALL_DURATION_MS + STARTUP_LOGO_FALL_JITTER_MS + STARTUP_LOGO_HOLD_DURATION_MS
export const STARTUP_LOGO_TICK_MS = 30

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

/**
 * Brightness ramp shared by every startup flourish. Index 0 is blank and index
 * MATRIX_RAIN_LEVELS is the head, so rain trails fade out of the same green the
 * dropping logo warms up from.
 */
export const MATRIX_RAIN_LEVEL_RGB: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [0, 80, 0],
  [0, 150, 25],
  [0, 215, 70],
  [205, 255, 220],
]

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

/** Merge adjacent equal-brightness cells into one run to bound span count. */
function mergeRuns(chars: string[], levels: number[], width: number): MatrixRainRun[] {
  const runs: MatrixRainRun[] = []
  let start = 0
  for (let x = 1; x <= width; x++) {
    if (x < width && levels[x] === levels[start]) continue
    runs.push({ text: chars.slice(start, x).join(""), level: levels[start] ?? 0 })
    start = x
  }
  return runs
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
    rows.push(mergeRuns(chars, levels, state.width))
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

/**
 * Startup playback is on by default so the flourish is visible without
 * configuration, but it stays one toggle away from off and still honors the
 * shared animation policy.
 */
export const MATRIX_RAIN_ON_START_DEFAULT = true

/**
 * Whether a fresh TUI launch should play the overlay. Shares the completion
 * gate but starts from a clean slate — nothing is playing and no dialog or
 * selection can exist yet — so only the startup flag and the animation policy
 * can hold it back.
 */
export function shouldPlayMatrixRainOnStart(input: {
  enabled: boolean
  animationsEnabled: boolean
  runtime?: RuntimeMode
}): boolean {
  return shouldAutoPlayMatrixRain({
    enabled: input.enabled,
    animationsEnabled: input.animationsEnabled,
    runtime: input.runtime,
    alreadyPlaying: false,
    dialogOpen: false,
    hasSelection: false,
  })
}

/**
 * Startup rain must not fire on kv defaults. kv.json loads asynchronously,
 * and `matrix_rain_on_start` defaults to on — reading before `ready` would
 * replay the overlay after the user turned it off.
 */
export function decideMatrixRainOnStart(input: {
  ready: boolean
  enabled: boolean
  animationsEnabled: boolean
  runtime?: RuntimeMode
}): boolean {
  if (!input.ready) return false
  return shouldPlayMatrixRainOnStart({
    enabled: input.enabled,
    animationsEnabled: input.animationsEnabled,
    runtime: input.runtime,
  })
}

/**
 * Startup chrome cover. `hold` hides the main screen until kv can honor a
 * persisted opt-out; `rain` keeps it covered while the overlay plays; `logo`
 * holds the centered brand mark between the rain and the working screen;
 * `app` is the normal UI. Compiled runtimes never animate, so they start in
 * `app`.
 */
export type StartupRainPhase = "hold" | "rain" | "logo" | "app"

export function initialStartupRainPhase(runtime?: RuntimeMode): StartupRainPhase {
  return shouldUseTuiAnimations({ runtime }) ? "hold" : "app"
}

export function resolveStartupRainPhase(input: {
  phase: StartupRainPhase
  ready: boolean
  enabled: boolean
  animationsEnabled: boolean
  runtime?: RuntimeMode
  dialogOpen: boolean
}): StartupRainPhase {
  if (input.phase === "app") return "app"
  if (input.dialogOpen) return "app"
  if (input.phase === "rain" || input.phase === "logo") return input.phase
  if (!input.ready) return "hold"
  return decideMatrixRainOnStart({
    ready: true,
    enabled: input.enabled,
    animationsEnabled: input.animationsEnabled,
    runtime: input.runtime,
  })
    ? "rain"
    : "app"
}

/** Hand the screen to the working UI — used after the logo beat and on skip. */
export function completeStartupRain(): StartupRainPhase {
  return "app"
}

/**
 * Where a finished startup rain goes next. Rain that played to completion
 * shows the brand logo; an explicit skip bypasses it via
 * `completeStartupRain`.
 */
export function startupRainAfterPlayback(): StartupRainPhase {
  return "logo"
}

export function startupRainShowsLogo(phase: StartupRainPhase): boolean {
  return phase === "logo"
}

/**
 * Center the logo block in the terminal. Offsets are floored so the block sits
 * marginally high/left rather than clipping the bottom/right on an odd gap,
 * and clamped at zero so a terminal narrower than the logo starts at column 0
 * instead of pushing the mark off screen.
 */
export function startupLogoPadding(input: {
  contentWidth: number
  contentHeight: number
  width: number
  height: number
}): { paddingTop: number; paddingLeft: number } {
  return {
    paddingTop: Math.max(0, Math.floor((input.height - input.contentHeight) / 2)),
    paddingLeft: Math.max(0, Math.floor((input.width - input.contentWidth) / 2)),
  }
}

/** Cubic ease-out: a fast fall that decelerates into the landing. */
export function easeOutLogoDrop(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress))
  return 1 - Math.pow(1 - clamped, 3)
}

/**
 * One character of the mark plus the random schedule it falls on. `row`/`col`
 * are its resting place inside the block.
 */
export interface StartupLogoGlyph {
  char: string
  row: number
  col: number
  /** Random start delay inside the stagger window. */
  delayMs: number
  /** Random fall duration for this character. */
  fallMs: number
}

/**
 * Build the per-character drop schedule. Trailing padding is layout only, so
 * blanks never become glyphs; each character draws its own delay and fall
 * duration, which is what randomizes who lands first.
 */
export function createStartupLogoGlyphs(input: { lines: string[]; random?: MatrixRainRandom }): StartupLogoGlyph[] {
  const random = input.random ?? Math.random
  const glyphs: StartupLogoGlyph[] = []
  input.lines.forEach((line, row) => {
    const text = line.trimEnd()
    for (let col = 0; col < text.length; col++) {
      const char = text[col]
      if (char === " ") continue
      glyphs.push({
        char,
        row,
        col,
        delayMs: between(random, 0, STARTUP_LOGO_STAGGER_MS),
        fallMs: between(
          random,
          STARTUP_LOGO_FALL_DURATION_MS,
          STARTUP_LOGO_FALL_DURATION_MS + STARTUP_LOGO_FALL_JITTER_MS,
        ),
      })
    }
  })
  return glyphs
}

/** Fall progress in [0, 1] for one glyph, its start delay included. */
export function startupLogoGlyphProgress(glyph: StartupLogoGlyph, elapsedMs: number): number {
  if (glyph.fallMs <= 0) return 1
  return Math.min(1, Math.max(0, (elapsedMs - glyph.delayMs) / glyph.fallMs))
}

/**
 * Screen row of a glyph at `elapsedMs`. Characters enter from just above the
 * top edge (`-1`) and ease onto their resting row, so each one arrives rather
 * than stopping dead. The clamps keep a late tick from travelling past it.
 */
export function startupLogoGlyphRow(input: { glyph: StartupLogoGlyph; elapsedMs: number; blockTop: number }): number {
  const target = input.blockTop + input.glyph.row
  return Math.round(-1 + (target + 1) * easeOutLogoDrop(startupLogoGlyphProgress(input.glyph, input.elapsedMs)))
}

/** Ramp level for a glyph: dim green while falling, white head once landed. */
export function startupLogoGlyphLevel(glyph: StartupLogoGlyph, elapsedMs: number): number {
  return startupLogoDropLevel(startupLogoGlyphProgress(glyph, elapsedMs))
}

/**
 * Render the mark for one tick as per-row color runs over the screen rows it
 * currently occupies. Characters still above the top edge are simply not
 * drawn, so no clipping is needed and every returned row is inside the
 * terminal.
 */
export function startupLogoFrame(input: {
  glyphs: StartupLogoGlyph[]
  elapsedMs: number
  blockLeft: number
  blockTop: number
  width: number
  height: number
}): { top: number; rows: MatrixRainRun[][] } {
  const placed = input.glyphs
    .map((glyph) => ({
      col: input.blockLeft + glyph.col,
      row: startupLogoGlyphRow({ glyph, elapsedMs: input.elapsedMs, blockTop: input.blockTop }),
      char: glyph.char,
      level: Math.round(startupLogoGlyphLevel(glyph, input.elapsedMs)),
    }))
    .filter((cell) => cell.row >= 0 && cell.row < input.height && cell.col >= 0 && cell.col < input.width)

  if (placed.length === 0) return { top: 0, rows: [] }

  const top = Math.min(...placed.map((cell) => cell.row))
  const bottom = Math.max(...placed.map((cell) => cell.row))
  const rows: MatrixRainRun[][] = []
  for (let y = top; y <= bottom; y++) {
    const chars: string[] = new Array(input.width).fill(" ")
    const levels = new Array<number>(input.width).fill(0)
    for (const cell of placed) {
      if (cell.row !== y) continue
      chars[cell.col] = cell.char
      levels[cell.col] = Math.max(levels[cell.col], cell.level)
    }
    rows.push(mergeRuns(chars, levels, input.width))
  }
  return { top, rows }
}

/**
 * Ramp level for the dropping logo: it starts on the dim green tail and
 * brightens to the white head as it lands, so the mark arrives with the color a
 * falling drop's head would have.
 */
export function startupLogoDropLevel(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress))
  return 1 + clamped * (MATRIX_RAIN_LEVELS - 1)
}

export function startupRainCoversChrome(phase: StartupRainPhase): boolean {
  return phase !== "app"
}

/** Stop a playing overlay if a dialog or selection appears after it started. */
export function shouldStopMatrixRain(input: { dialogOpen: boolean; hasSelection: boolean }): boolean {
  return input.dialogOpen || input.hasSelection
}

/** Renderer surface used to hide the terminal cursor while rain covers the screen. */
export interface MatrixRainCursorRenderer {
  setCursorPosition(x: number, y: number, visible?: boolean): void
  addPostProcessFn(fn: (buffer: unknown, deltaTime: number) => void): void
  removePostProcessFn(fn: (buffer: unknown, deltaTime: number) => void): void
  requestRender(): void
}

/**
 * Hide the focused prompt's terminal cursor for as long as the overlay is up.
 * The textarea stays focused (keys still reach it); the overlay just wins the
 * cursor bit after each frame's renderables run.
 */
export function bindHiddenTerminalCursor(renderer: MatrixRainCursorRenderer): () => void {
  const hide = () => renderer.setCursorPosition(0, 0, false)
  renderer.addPostProcessFn(hide)
  hide()
  renderer.requestRender()
  return () => {
    renderer.removePostProcessFn(hide)
    renderer.requestRender()
  }
}
