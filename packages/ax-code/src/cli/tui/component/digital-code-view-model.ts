import { shouldUseTuiAnimations } from "./spinner-profile"
import type { RuntimeMode } from "@/installation/runtime-mode"

// ASCII-only glyph set. The TUI lays out positioned rows by cell width, and
// East Asian Width "Ambiguous"/"Wide" glyphs can break that math.
// Every code point here is < 0x80.
// Glyph pools by ink weight. A terminal cell cannot change font size, so a
// denser glyph is what makes a column read as a bigger drop than one drawn from
// the sparse pool. Both pools stay ASCII-only for the same reason as above.
export const DIGITAL_CODE_HEAVY_GLYPHS = "#@%&$WMNB8Q0"
export const DIGITAL_CODE_LIGHT_GLYPHS = "ACDEFGHIJKLOPRSTUVXYZ12345679*+=-:<>"
export const DIGITAL_CODE_GLYPHS = DIGITAL_CODE_HEAVY_GLYPHS + DIGITAL_CODE_LIGHT_GLYPHS

// The overlay is a short, dismissible flourish: long enough to read as rain,
// short enough to never feel like the terminal has been taken hostage. The
// floor tracks the requested startup playback length, which is the default.
export const DIGITAL_CODE_MIN_DURATION_MS = 2_500
export const DIGITAL_CODE_MAX_DURATION_MS = 5_000
export const DIGITAL_CODE_DURATION_MS = 2_500
export const DIGITAL_CODE_TICK_MS = 50
// Reverse (bottom-to-top) playback for the explicit-exit flourish. Fixed at the
// requested three seconds: long enough to read as the session winding down,
// short enough that quitting still feels immediate.
export const DIGITAL_CODE_REVERSE_DURATION_MS = 3_000

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

// Rain columns are spread across fixed lanes, one per `spacing` cells, rather
// than one per cell. That keeps the lit cell count (and therefore terminal
// output per frame) proportional to height / spacing instead of height * width,
// which is what makes a full screen animation affordable without a bespoke
// native renderable. Each column then jitters inside its own lane, so the drops
// stop lining up on a visible grid without moving that bound.
// Opening streaks leave broad black gaps; the ending doubles lane density.
export const DIGITAL_CODE_COLUMN_SPACING = 6
export const DIGITAL_CODE_ENDING_COLUMN_SPACING = 3
export const DIGITAL_CODE_LEVELS = 6
export const DIGITAL_CODE_MIN_TRAIL = 16
export const DIGITAL_CODE_MAX_TRAIL = 36
export const DIGITAL_CODE_MIN_SPEED = 0.35
export const DIGITAL_CODE_MAX_SPEED = 1.1
export const DIGITAL_CODE_TAIL_MUTATION_CHANCE = 0.35
// Most streaks use full-ink ASCII glyphs and bold to read as a continuous,
// heavy meteor inside fixed terminal cells. Keep a few lighter streaks for depth.
export const DIGITAL_CODE_HEAVY_COLUMN_CHANCE = 0.85
export const DIGITAL_CODE_RESPAWN_GAP = 20

/** Neon hues are chosen once per drop and stay stable until it respawns. */
export type DigitalCodeHue = "purple" | "blue" | "highlight"

/** Shared brightness ramps: blank at index 0, neon highlights at the head. */
export const DIGITAL_CODE_LEVEL_RGB: Record<DigitalCodeHue, readonly (readonly [number, number, number])[]> = {
  purple: [
    [0, 0, 0],
    [20, 2, 35],
    [45, 8, 75],
    [90, 24, 154],
    [123, 44, 191],
    [157, 78, 221],
    [235, 140, 255],
  ],
  blue: [
    [0, 0, 0],
    [0, 18, 30],
    [0, 40, 65],
    [0, 90, 125],
    [0, 140, 185],
    [0, 180, 216],
    [144, 224, 239],
  ],
  highlight: [
    [0, 0, 0],
    [16, 20, 26],
    [35, 45, 58],
    [70, 90, 116],
    [120, 150, 185],
    [190, 215, 240],
    [255, 255, 255],
  ],
}

/** Injectable randomness so frames are deterministic in tests. */
export type DigitalCodeRandom = () => number

/**
 * Travel direction. `down` is the startup rain (drops fall from the top edge);
 * `up` is the reverse rain used on explicit exit (drops rise from the bottom).
 */
export type DigitalCodeDirection = "down" | "up"

export interface DigitalCodeColumn {
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
  /** Dense pool plus bold, so this column reads as a bigger drop. */
  heavy: boolean
  /** Main color stays stable; individual glyphs may have a rare accent. */
  hue: DigitalCodeHue
  hues: DigitalCodeHue[]
}

export interface DigitalCodeState {
  width: number
  height: number
  columns: DigitalCodeColumn[]
  random: DigitalCodeRandom
  /** Which way the drops travel; preserved across ticks and resizes. */
  direction: DigitalCodeDirection
}

export interface DigitalCodeRun {
  text: string
  /** 0 = blank; 1..DIGITAL_CODE_LEVELS = brightness (see digitalCodeCellLevel). */
  level: number
  /** Draw bold; set for cells belonging to a heavy column. */
  bold: boolean
  hue: DigitalCodeHue
}

function between(random: DigitalCodeRandom, min: number, max: number): number {
  return min + random() * (max - min)
}

function glyphPool(heavy: boolean): string {
  return heavy ? DIGITAL_CODE_HEAVY_GLYPHS : DIGITAL_CODE_LIGHT_GLYPHS
}

function glyph(random: DigitalCodeRandom, pool: string): string {
  const index = Math.min(pool.length - 1, Math.floor(random() * pool.length))
  return pool[index] ?? " "
}

function glyphHue(random: DigitalCodeRandom, base: DigitalCodeHue): DigitalCodeHue {
  const value = random()
  if (value > 0.98) return "highlight"
  if (value < 0.02) return base === "purple" ? "blue" : "purple"
  return base
}

function makeColumn(random: DigitalCodeRandom, x: number, head: number): DigitalCodeColumn {
  const length = Math.max(
    DIGITAL_CODE_MIN_TRAIL,
    Math.floor(between(random, DIGITAL_CODE_MIN_TRAIL, DIGITAL_CODE_MAX_TRAIL + 1)),
  )
  // Ink weight is drawn once and kept for the column's whole life, so a big
  // drop never flickers between weights mid-fall.
  const heavy = random() < DIGITAL_CODE_HEAVY_COLUMN_CHANCE
  const pool = glyphPool(heavy)
  const hue = random() < 0.9 ? "purple" : "blue"
  return {
    x,
    head,
    heavy,
    hue,
    hues: Array.from({ length }, () => glyphHue(random, hue)),
    speed: between(random, DIGITAL_CODE_MIN_SPEED, DIGITAL_CODE_MAX_SPEED),
    length,
    chars: Array.from({ length }, () => glyph(random, pool)),
  }
}

/** Lane starts: evenly spaced and centred, one column may live in each. */
function columnSpacing(direction: DigitalCodeDirection): number {
  return direction === "up" ? DIGITAL_CODE_ENDING_COLUMN_SPACING : DIGITAL_CODE_COLUMN_SPACING
}

function columnSlots(width: number, spacing: number): number[] {
  const count = Math.max(1, Math.floor(width / spacing))
  const span = (count - 1) * spacing
  const offset = Math.max(0, Math.floor((width - span - 1) / 2))
  return Array.from({ length: count }, (_, index) => offset + index * spacing)
}

/**
 * Where a column actually sits inside its lane. The jitter never leaves the
 * lane, so columns keep one apiece, stay in order and never collide — the
 * per-frame lit-cell bound is unchanged — while the rows stop lining up on a
 * visible grid. Clamping to the last cell covers the rightmost lane, whose
 * lane end can reach the terminal edge.
 */
function columnPosition(random: DigitalCodeRandom, slot: number, width: number, spacing: number): number {
  const jitter = Math.floor(random() * spacing)
  return Math.min(width - 1, slot + jitter)
}

export function createDigitalCode(input: {
  width: number
  height: number
  random?: DigitalCodeRandom
  direction?: DigitalCodeDirection
}): DigitalCodeState {
  const width = Math.max(1, Math.floor(input.width))
  const height = Math.max(1, Math.floor(input.height))
  const random = input.random ?? Math.random
  const direction = input.direction ?? "down"
  // Stagger initial heads so columns start moving immediately instead of all
  // entering from the same edge on the same tick.
  const spacing = columnSpacing(direction)
  const columns = columnSlots(width, spacing).map((slot) =>
    makeColumn(random, columnPosition(random, slot, width, spacing), initialHead(random, height, direction)),
  )
  return { width, height, columns, random, direction }
}

/**
 * Starting head for a new column. Down rain staggers from above the top edge
 * (negative rows) into the screen; the reverse rain mirrors that range so some
 * columns are already rising on the first frame while the rest enter from below.
 */
function initialHead(random: DigitalCodeRandom, height: number, direction: DigitalCodeDirection): number {
  const spread = Math.max(4, height * 0.6)
  return direction === "up" ? between(random, 0, height + spread) : between(random, -spread, height)
}

export function advanceDigitalCode(state: DigitalCodeState): DigitalCodeState {
  const up = state.direction === "up"
  const columns = state.columns.map((column) => {
    const head = column.head + (up ? -column.speed : column.speed)
    // A column is spent once its whole trail has left the screen it travels
    // toward — the bottom edge going down, the top edge going up — and then
    // re-enters from the opposite edge.
    if (up ? head + column.length < 0 : head - column.length > state.height) {
      const respawn = up
        ? state.height + between(state.random, 1, DIGITAL_CODE_RESPAWN_GAP)
        : -between(state.random, 1, DIGITAL_CODE_RESPAWN_GAP)
      return makeColumn(state.random, column.x, respawn)
    }
    const pool = glyphPool(column.heavy)
    const chars = column.chars.slice()
    const hues = column.hues.slice()
    chars[0] = glyph(state.random, pool)
    hues[0] = glyphHue(state.random, column.hue)
    if (chars.length > 1 && state.random() < DIGITAL_CODE_TAIL_MUTATION_CHANCE) {
      const index = 1 + Math.floor(state.random() * (chars.length - 1))
      chars[index] = glyph(state.random, pool)
      hues[index] = glyphHue(state.random, column.hue)
    }
    return { ...column, head, chars, hues }
  })
  return { ...state, columns }
}

function levelFor(offset: number, length: number): number {
  const level = DIGITAL_CODE_LEVELS - Math.round((offset * (DIGITAL_CODE_LEVELS - 1)) / Math.max(1, length - 1))
  return Math.min(DIGITAL_CODE_LEVELS, Math.max(1, level))
}

/**
 * Brightness of one trail cell. The falling rain keeps the classic look: the
 * head is the brightest cell and the trail above it fades to dim neon. The reverse
 * rain mirrors the streak on screen instead of the ramp, so it still reads
 * dim at the top and bright at the bottom — its ramp runs against the offset,
 * whose 0 is the leading (top) cell.
 */
export function digitalCodeCellLevel(direction: DigitalCodeDirection, offset: number, length: number): number {
  const level = levelFor(offset, length)
  return direction === "up" ? DIGITAL_CODE_LEVELS + 1 - level : level
}

/**
 * Advance one tick against the current terminal size. A resize rebuilds the
 * columns from scratch rather than rescaling them, so no glyph is ever drawn
 * outside the new width.
 */
export function tickDigitalCode(state: DigitalCodeState, size: { width: number; height: number }): DigitalCodeState {
  // Normalize the incoming size exactly like createDigitalCode does. Comparing
  // the raw size to already-clamped dimensions would treat a 0-cell or
  // fractional terminal as a resize on every tick, rebuilding the columns from
  // their initial heads so the rain never advances.
  const width = Math.max(1, Math.floor(size.width))
  const height = Math.max(1, Math.floor(size.height))
  if (state.width !== width || state.height !== height) {
    return createDigitalCode({
      width,
      height,
      random: state.random,
      direction: state.direction,
    })
  }
  return advanceDigitalCode(state)
}

/** Merge adjacent cells sharing brightness, weight, and hue into one run, so the
 * per-frame span count stays bounded. */
function mergeRuns(
  chars: string[],
  levels: number[],
  bold: boolean[],
  hues: DigitalCodeHue[],
  width: number,
): DigitalCodeRun[] {
  const runs: DigitalCodeRun[] = []
  let start = 0
  for (let x = 1; x <= width; x++) {
    if (x < width && levels[x] === levels[start] && bold[x] === bold[start] && hues[x] === hues[start]) continue
    runs.push({
      text: chars.slice(start, x).join(""),
      level: levels[start] ?? 0,
      bold: bold[start] ?? false,
      hue: hues[start] ?? "purple",
    })
    start = x
  }
  return runs
}

/**
 * Render one frame as per-row color runs. Rows are top-to-bottom; cells with
 * the same brightness, hue, and weight are merged into a single run so the renderer emits a
 * bounded number of spans per row.
 */
export function digitalCodeRows(state: DigitalCodeState): DigitalCodeRun[][] {
  const rows: DigitalCodeRun[][] = []
  for (let y = 0; y < state.height; y++) {
    const chars: string[] = new Array(state.width).fill(" ")
    const levels = new Array<number>(state.width).fill(0)
    const bold = new Array<boolean>(state.width).fill(false)
    const hues = new Array<DigitalCodeHue>(state.width).fill("purple")
    for (const column of state.columns) {
      if (column.x < 0 || column.x >= state.width) continue
      // The head is offset 0 and the trail counts away from it. Down rain
      // trails above a falling head; the reverse rain trails below a rising
      // head, so the sign of the offset flips with the direction.
      const offset = state.direction === "up" ? y - Math.floor(column.head) : Math.floor(column.head) - y
      if (offset < 0 || offset >= column.length) continue
      chars[column.x] = column.chars[offset] ?? " "
      levels[column.x] = digitalCodeCellLevel(state.direction, offset, column.length)
      bold[column.x] = column.heavy
      hues[column.x] = column.hues[offset] ?? column.hue
    }
    rows.push(mergeRuns(chars, levels, bold, hues, state.width))
  }
  return rows
}

/**
 * Whether a completion event should launch the overlay automatically. The
 * effect is opt-in and never interrupts a dialog, a text selection, or a run
 * that is already on screen.
 */
export function shouldAutoPlayDigitalCode(input: {
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
export const DIGITAL_CODE_ON_START_DEFAULT = true

/**
 * Whether a fresh TUI launch should play the overlay. Shares the completion
 * gate but starts from a clean slate — nothing is playing and no dialog or
 * selection can exist yet — so only the startup flag and the animation policy
 * can hold it back.
 */
export function shouldPlayDigitalCodeOnStart(input: {
  enabled: boolean
  animationsEnabled: boolean
  runtime?: RuntimeMode
}): boolean {
  return shouldAutoPlayDigitalCode({
    enabled: input.enabled,
    animationsEnabled: input.animationsEnabled,
    runtime: input.runtime,
    alreadyPlaying: false,
    dialogOpen: false,
    hasSelection: false,
  })
}

/**
 * Whether an explicit-quit flourish (the reverse rain) may play. It needs no
 * opt-in flag of its own — the rain is bound to an explicit quit — but it still
 * honors the shared animation policy, so `animations_enabled` turns it off.
 */
export function shouldPlayExitDigitalCode(input: { animationsEnabled: boolean; runtime?: RuntimeMode }): boolean {
  return shouldUseTuiAnimations({ userEnabled: input.animationsEnabled, runtime: input.runtime })
}

/**
 * Startup rain must not fire on kv defaults. kv.json loads asynchronously,
 * and `digital_code_on_start` defaults to on — reading before `ready` would
 * replay the overlay after the user turned it off.
 */
export function decideDigitalCodeOnStart(input: {
  ready: boolean
  enabled: boolean
  animationsEnabled: boolean
  runtime?: RuntimeMode
}): boolean {
  if (!input.ready) return false
  return shouldPlayDigitalCodeOnStart({
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
  return decideDigitalCodeOnStart({
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
  hue: DigitalCodeHue
}

/**
 * Build the per-character drop schedule. Trailing padding is layout only, so
 * blanks never become glyphs; each character draws its own delay and fall
 * duration, which is what randomizes who lands first.
 */
export function createStartupLogoGlyphs(input: { lines: string[]; random?: DigitalCodeRandom }): StartupLogoGlyph[] {
  const random = input.random ?? Math.random
  const glyphs: StartupLogoGlyph[] = []
  input.lines.forEach((line, row) => {
    const text = line.trimEnd()
    for (let col = 0; col < text.length; col++) {
      const char = text[col]
      if (char === " ") continue
      glyphs.push({
        char,
        hue: random() < 0.5 ? "purple" : "blue",
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

/** Ramp level for a glyph: dim neon while falling, bright highlight once landed. */
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
}): { top: number; rows: DigitalCodeRun[][] } {
  const placed = input.glyphs
    .map((glyph) => ({
      col: input.blockLeft + glyph.col,
      row: startupLogoGlyphRow({ glyph, elapsedMs: input.elapsedMs, blockTop: input.blockTop }),
      char: glyph.char,
      hue: glyph.hue,
      level: Math.round(startupLogoGlyphLevel(glyph, input.elapsedMs)),
    }))
    .filter((cell) => cell.row >= 0 && cell.row < input.height && cell.col >= 0 && cell.col < input.width)

  if (placed.length === 0) return { top: 0, rows: [] }

  const top = Math.min(...placed.map((cell) => cell.row))
  const bottom = Math.max(...placed.map((cell) => cell.row))
  const rows: DigitalCodeRun[][] = []
  for (let y = top; y <= bottom; y++) {
    const chars: string[] = new Array(input.width).fill(" ")
    const levels = new Array<number>(input.width).fill(0)
    const bold = new Array<boolean>(input.width).fill(false)
    const hues = new Array<DigitalCodeHue>(input.width).fill("purple")
    for (const cell of placed) {
      if (cell.row !== y) continue
      // The drawn character, brightness and hue must come from the same glyph.
      // When two land in one cell the brighter one wins outright, rather than
      // taking the character from one glyph and the color from another.
      if (cell.level < levels[cell.col]) continue
      chars[cell.col] = cell.char
      hues[cell.col] = cell.hue
      levels[cell.col] = cell.level
    }
    rows.push(mergeRuns(chars, levels, bold, hues, input.width))
  }
  return { top, rows }
}

/**
 * Ramp level for the dropping logo: it starts on the dim neon tail and
 * brightens to the neon highlight as it lands, so the mark arrives with the color a
 * falling drop's head would have.
 */
export function startupLogoDropLevel(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress))
  return 1 + clamped * (DIGITAL_CODE_LEVELS - 1)
}

export function startupRainCoversChrome(phase: StartupRainPhase): boolean {
  return phase !== "app"
}

/**
 * Whether an animated overlay already owns the screen: the opening run, the
 * ending run, or a startup phase that still covers the chrome. A completion
 * flourish must never start above any of them.
 */
export function digitalCodeOverlayActive(input: {
  opening: boolean
  ending: boolean
  startupPhase: StartupRainPhase
}): boolean {
  return input.opening || input.ending || startupRainCoversChrome(input.startupPhase)
}

/**
 * One wall-clock step of the logo beat. The frames and the hand-off share this
 * clock, so a lagging event loop can only delay the beat — it can never finish
 * it before the mark's glyphs have landed.
 */
export function startupLogoTick(input: { startedAt: number; now: number; durationMs: number }): {
  elapsedMs: number
  done: boolean
} {
  const elapsedMs = Math.max(0, input.now - input.startedAt)
  return { elapsedMs, done: elapsedMs >= input.durationMs }
}

/** Stop a playing overlay if a dialog or selection appears after it started. */
export function shouldStopDigitalCode(input: { dialogOpen: boolean; hasSelection: boolean }): boolean {
  return input.dialogOpen || input.hasSelection
}

/**
 * Which overlays the interrupt effect must clear when a dialog or selection
 * appears after they started. The ending/exit overlay renders with
 * `captureInput`, so it has to be stopped as well: the effect exists so an
 * interactive dialog is never left hidden behind a keyboard-blocking overlay.
 * Stopping the ending resolves its pending play promise, so a caller awaiting
 * the flourish is not left hanging.
 */
export function interruptOverlayPlan(input: {
  interrupted: boolean
  opening: boolean
  ending: boolean
  startupPhase: StartupRainPhase
}): { opening: boolean; ending: boolean; startup: boolean } {
  if (!input.interrupted) return { opening: false, ending: false, startup: false }
  return { opening: input.opening, ending: input.ending, startup: input.startupPhase !== "app" }
}

/** Renderer surface used to hide the terminal cursor while rain covers the screen. */
export interface DigitalCodeCursorRenderer {
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
export function bindHiddenTerminalCursor(renderer: DigitalCodeCursorRenderer): () => void {
  const hide = () => renderer.setCursorPosition(0, 0, false)
  renderer.addPostProcessFn(hide)
  hide()
  renderer.requestRender()
  return () => {
    renderer.removePostProcessFn(hide)
    renderer.requestRender()
  }
}
