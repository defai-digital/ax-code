import type { FujiRun } from "./fuji-view-model"

/**
 * Single-style family: both AnimationPair slots hold "taegeuk". The emblem
 * spins once and settles into the official flag orientation.
 */
export type TaegeukStyle = "taegeuk"
export function isTaegeukStyle(style: string | undefined): style is TaegeukStyle {
  return style === "taegeuk"
}

/** Reference composition size shared by both renderers. */
export const TAEGEUK_COLUMNS = 76
export const TAEGEUK_ROWS = 24
/** Flag field in scene cells. Cells are twice as tall as wide, so 54x18 is the official 3:2. */
export const TAEGEUK_FIELD = { x0: 11, x1: 65, y0: 1, y1: 19 } as const
export const TAEGEUK_CENTER = { x: 38, y: 10 } as const
/**
 * Official construction sheet in flag units: a 144x96 field with the origin
 * at its center and y pointing down. The disc diameter is half the height.
 */
export const TAEGEUK_FLAG = { width: 144, height: 96, radius: 24 } as const
/** The emblem axis and the trigrams follow the field diagonals. */
export const TAEGEUK_TILT = Math.atan2(2, 3)
/**
 * Trigram bars, innermost first; true marks a broken bar. Geon sits at the
 * upper hoist, gam at the upper fly, ri at the lower hoist, gon at the lower fly.
 */
export const TAEGEUK_TRIGRAMS = {
  geon: [false, false, false],
  gam: [true, false, true],
  ri: [false, true, false],
  gon: [true, true, true],
} as const
export const TAEGEUK_GROUND_TOP = 20
/** Four twinkle frames on a 1200ms round. */
export const TAEGEUK_FRAME_MS = 300
/** One eased turn of the emblem before it rests in the official orientation. */
export const TAEGEUK_SPIN_MS = 1500
export const TAEGEUK_CONFETTI_COUNT = 12
/** Floodlight pylon masts outside the flag field. */
export const TAEGEUK_PYLONS = [1, 74] as const

/** Palette shared by the text and pixel renderers. Flag colors are the official ones. */
export const TAEGEUK_COLORS = {
  taegeuk: {
    sky: "#8ba0c8",
    skyBottom: "#cfdcf2",
    field: "#ffffff",
    red: "#cd2e3a",
    blue: "#0047a0",
    trigram: "#000000",
    mast: "#2c2c3a",
    ground: "#3d4a5a",
    crowd: "#a8b0c8",
    flood: "#fff3b0",
    spark: "#e8c84a",
  },
} as const satisfies Record<TaegeukStyle, Record<string, string>>

/** Sky behind the flag, dark enough for the white field to read. */
export function taegeukBackground(_style: TaegeukStyle) {
  return "#a8c0e6"
}

/** Sample the vertical sky gradient. `t` is 0 at the top of the frame. */
export function taegeukSkyRgb(style: TaegeukStyle, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(taegeukBackground(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(TAEGEUK_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

/** Twinkle frame 0..3 advancing every 300ms. */
export function taegeukFrame(elapsedMs: number): number {
  return Math.floor(Math.max(0, elapsedMs) / TAEGEUK_FRAME_MS) % 4
}

/** Emblem rotation on top of the official tilt: one eased clockwise turn that settles at zero. */
export function taegeukSpin(elapsedMs: number): number {
  if (elapsedMs >= TAEGEUK_SPIN_MS) return 0
  const t = Math.max(0, elapsedMs / TAEGEUK_SPIN_MS)
  return 2 * Math.PI * (t * t * (3 - 2 * t) - 1)
}

/**
 * Emblem sampler in flag units. Red sits on top with its head toward the
 * hoist and blue below with its head toward the fly; no eyes, no outline.
 * Returns undefined outside the disc.
 */
export function taegeukEmblem(spin: number): (x: number, y: number) => "red" | "blue" | undefined {
  const cos = Math.cos(TAEGEUK_TILT + spin)
  const sin = Math.sin(TAEGEUK_TILT + spin)
  const radius = TAEGEUK_FLAG.radius
  const head = radius / 2
  return (x, y) => {
    if (x * x + y * y > radius * radius) return undefined
    const along = x * cos + y * sin
    const across = y * cos - x * sin
    if ((along + head) * (along + head) + across * across <= head * head) return "red"
    if ((along - head) * (along - head) + across * across <= head * head) return "blue"
    return across < 0 ? "red" : "blue"
  }
}

const TILT_COS = Math.cos(TAEGEUK_TILT)
const TILT_SIN = Math.sin(TAEGEUK_TILT)
/** Trigram pairs per diagonal: axis sine, then the hoist-side and fly-side bars. */
const TAEGEUK_DIAGONALS = [
  [TILT_SIN, TAEGEUK_TRIGRAMS.geon, TAEGEUK_TRIGRAMS.gon],
  [-TILT_SIN, TAEGEUK_TRIGRAMS.ri, TAEGEUK_TRIGRAMS.gam],
] as const

/**
 * Whether a flag-unit point lies on a trigram bar. Bars are 24 long and 4
 * thick, centered 38, 44, and 50 units out along a diagonal; broken bars
 * leave a 2-unit gap in the middle.
 */
export function taegeukBar(x: number, y: number): boolean {
  for (const [sin, hoist, fly] of TAEGEUK_DIAGONALS) {
    const along = x * TILT_COS + y * sin
    const across = y * TILT_COS - x * sin
    const reach = Math.abs(along) - 36
    if (reach < 0 || reach > 16 || Math.abs(across) > 12) continue
    const index = Math.min(2, Math.floor(reach / 6))
    if (reach - index * 6 > 4) continue
    if (!(along < 0 ? hoist : fly)[index] || Math.abs(across) >= 1) return true
  }
  return false
}

export type TaegeukConfetti = { x: number; y: number; red: boolean }
/** Red/blue confetti tumbling behind the flag. */
export function taegeukConfetti(elapsedMs: number): TaegeukConfetti[] {
  const step = Math.floor(Math.max(0, elapsedMs) / 120)
  return Array.from({ length: TAEGEUK_CONFETTI_COUNT }, (_, i) => ({
    x: (i * 31 + step * 3) % TAEGEUK_COLUMNS,
    y: (step + i * 5) % (TAEGEUK_GROUND_TOP - 1),
    red: i % 2 === 0,
  }))
}

export type TaegeukSpark = { x: number; y: number }
/** Sky sites beside the flag; every other one lights per twinkle frame. */
const TAEGEUK_SPARK_SITES: readonly TaegeukSpark[] = [
  { x: 6, y: 3 },
  { x: 4, y: 6 },
  { x: 69, y: 6 },
  { x: 71, y: 3 },
  { x: 8, y: 9 },
  { x: 5, y: 12 },
  { x: 67, y: 12 },
  { x: 70, y: 9 },
]
/** Golden sparks twinkling in the sky beside the flag, never on the field. */
export function taegeukSparks(elapsedMs: number): TaegeukSpark[] {
  const frame = taegeukFrame(elapsedMs)
  return TAEGEUK_SPARK_SITES.filter((_, k) => (k + frame) % 2 === 0)
}

/** Crowd wave phase 0..3 advancing every 300ms. */
export function taegeukWave(elapsedMs: number): number {
  return Math.floor(Math.max(0, elapsedMs) / 300) % 4
}

export function taegeukRows(columns: number, rows: number, style: TaegeukStyle, elapsedMs: number): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const colors = TAEGEUK_COLORS[style]
  const grid: FujiRun[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: colors.sky })),
  )
  const left = Math.floor((width - TAEGEUK_COLUMNS) / 2),
    top = Math.floor((height - TAEGEUK_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + Math.round(y)
    if (row < 0 || row >= height) return
    for (let i = 0; i < text.length; i++) {
      const sceneX = Math.round(x) + i
      const column = left + sceneX
      if (sceneX < 0 || sceneX >= TAEGEUK_COLUMNS || column < 0 || column >= width) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }
  // Confetti and sparks stay behind the flag so the field is never marked.
  for (const bit of taegeukConfetti(elapsedMs)) {
    paint(bit.x, bit.y, "*", bit.red ? colors.red : colors.blue)
  }
  for (const spark of taegeukSparks(elapsedMs)) {
    paint(spark.x, spark.y, "*", colors.spark)
  }
  // White 3:2 field with the emblem sampled at each cell center. Glyphs
  // share the cell background, so the halves read as solid color.
  const field = TAEGEUK_FIELD
  const emblem = taegeukEmblem(taegeukSpin(elapsedMs))
  const perColumn = TAEGEUK_FLAG.width / (field.x1 - field.x0)
  const perRow = TAEGEUK_FLAG.height / (field.y1 - field.y0)
  for (let y = field.y0; y < field.y1; y++) {
    for (let x = field.x0; x < field.x1; x++) {
      const side = emblem((x + 0.5 - TAEGEUK_CENTER.x) * perColumn, (y + 0.5 - TAEGEUK_CENTER.y) * perRow)
      if (side === "red") paint(x, y, "@", colors.red, colors.red)
      else if (side === "blue") paint(x, y, "%", colors.blue, colors.blue)
      else paint(x, y, " ", colors.field, colors.field)
    }
  }
  // Trigrams as three leaning strokes; a broken bar skips the middle row.
  // Every pattern is symmetric, so the stroke order does not matter.
  const trigram = (x: number, y: number, stroke: "/" | "\\", bars: readonly boolean[]) => {
    for (let row = 0; row < 5; row++) {
      bars.forEach((broken, k) => {
        if (row === 2 && broken) return
        paint(x + 2 * k + (stroke === "/" ? 4 - row : row), y + row, stroke, colors.trigram, colors.field)
      })
    }
  }
  trigram(20, 3, "/", TAEGEUK_TRIGRAMS.geon)
  trigram(47, 3, "\\", TAEGEUK_TRIGRAMS.gam)
  trigram(20, 12, "\\", TAEGEUK_TRIGRAMS.ri)
  trigram(47, 12, "/", TAEGEUK_TRIGRAMS.gon)
  // Floodlight pylons outside the flag field.
  for (const pylon of TAEGEUK_PYLONS) {
    paint(pylon, 14, "o", colors.flood)
    for (let y = 15; y <= 19; y++) {
      paint(pylon, y, "|", colors.mast)
    }
  }
  for (let y = TAEGEUK_GROUND_TOP; y < TAEGEUK_ROWS; y++) {
    paint(0, y, " ".repeat(TAEGEUK_COLUMNS), colors.ground, colors.ground)
  }
  // A crowd wave rolling under the flag.
  const wave = taegeukWave(elapsedMs)
  for (let x = 0; x < TAEGEUK_COLUMNS; x++) {
    paint(x, TAEGEUK_GROUND_TOP, (x + wave) % 4 === 0 ? "o" : ".", colors.crowd, colors.ground)
    paint(x, TAEGEUK_GROUND_TOP + 1, (x + wave + 2) % 4 === 0 ? "o" : ".", colors.crowd, colors.ground)
  }
  return grid.map((row) => {
    const runs: FujiRun[] = []
    for (const cell of row) {
      const last = runs.at(-1)
      if (last?.color === cell.color && last.background === cell.background) last.text += cell.text
      else runs.push({ ...cell })
    }
    return runs
  })
}
