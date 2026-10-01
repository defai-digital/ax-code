import type { FujiRun } from "./fuji-view-model"

/**
 * Single-style family: the ending replays the same spin reversed, like the
 * digital-code pair. Both AnimationPair slots hold "taegeuk".
 */
export type TaegeukStyle = "taegeuk"
export function isTaegeukStyle(style: string | undefined): style is TaegeukStyle {
  return style === "taegeuk"
}

/** Reference composition size shared by both renderers. */
export const TAEGEUK_COLUMNS = 76
export const TAEGEUK_ROWS = 24
export const TAEGEUK_CENTER = { x: 38, y: 11 } as const
export const TAEGEUK_RADIUS = 7
export const TAEGEUK_DOT_ORBIT = 3.5
export const TAEGEUK_TICKS = 12
export const TAEGEUK_BORDER = { x0: 4, x1: 71, y0: 1, y1: 18 } as const
export const TAEGEUK_GROUND_TOP = 20
/** Four rotation frames on a 1200ms round. */
export const TAEGEUK_FRAME_MS = 300
export const TAEGEUK_CONFETTI_COUNT = 12
export const TAEGEUK_SPARK_COUNT = 4
export const TAEGEUK_SPARK_ORBIT = TAEGEUK_RADIUS + 2
/** Floodlight pylon masts outside the flag field. */
export const TAEGEUK_PYLONS = [1, 74] as const

/** Palette shared by the text and pixel renderers. */
export const TAEGEUK_COLORS = {
  taegeuk: {
    sky: "#8ba0c8",
    skyBottom: "#e8ecf5",
    red: "#c33d4e",
    blue: "#2a4a9a",
    ring: "#2c2c3a",
    ray: "#b8c0d4",
    trigram: "#2c2c3a",
    ground: "#3d4a5a",
    crowd: "#a8b0c8",
    flood: "#fff3b0",
    spark: "#e8c84a",
  },
} as const satisfies Record<TaegeukStyle, Record<string, string>>

export function taegeukBackground(_style: TaegeukStyle) {
  return "#f2f4fa"
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

/** Rotation frame 0..3 advancing every 300ms. */
export function taegeukFrame(elapsedMs: number): number {
  return Math.floor(Math.max(0, elapsedMs) / TAEGEUK_FRAME_MS) % 4
}

/** Red half indicator for a cell angle at rotation frame `frame`. */
export function taegeukRed(angle: number, frame: number): boolean {
  const rotated = angle - (frame * Math.PI) / 2
  return Math.sin(rotated) >= 0
}

export type TaegeukConfetti = { x: number; y: number; red: boolean }
/** Red/blue confetti tumbling over the emblem. */
export function taegeukConfetti(elapsedMs: number): TaegeukConfetti[] {
  const step = Math.floor(Math.max(0, elapsedMs) / 120)
  return Array.from({ length: TAEGEUK_CONFETTI_COUNT }, (_, i) => ({
    x: (i * 31 + step * 3) % TAEGEUK_COLUMNS,
    y: (step + i * 5) % (TAEGEUK_GROUND_TOP - 1),
    red: i % 2 === 0,
  }))
}

export type TaegeukSpark = { x: number; y: number }
/** Golden sparks orbiting the disc with the rotation frame. */
export function taegeukSparks(elapsedMs: number): TaegeukSpark[] {
  const frame = taegeukFrame(elapsedMs)
  return Array.from({ length: TAEGEUK_SPARK_COUNT }, (_, k) => {
    const angle = (frame * Math.PI) / 2 + (k * Math.PI) / 2
    return {
      x: Math.round(TAEGEUK_CENTER.x + Math.cos(angle) * TAEGEUK_SPARK_ORBIT),
      y: Math.round(TAEGEUK_CENTER.y + Math.sin(angle) * TAEGEUK_SPARK_ORBIT),
    }
  })
}

/** Crowd wave phase 0..3 advancing every 300ms. */
export function taegeukWave(elapsedMs: number): number {
  return Math.floor(Math.max(0, elapsedMs) / 300) % 4
}

export type TaegeukDot = { x: number; y: number; red: boolean }
/** Counter-colored eyes orbiting inside the halves at rotation frame `frame`. */
export function taegeukDots(elapsedMs: number): TaegeukDot[] {
  const frame = taegeukFrame(elapsedMs)
  return [0, 1].map((k) => {
    const angle = (frame * Math.PI) / 2 + Math.PI / 2 + k * Math.PI
    const x = Math.round(TAEGEUK_CENTER.x + Math.cos(angle) * TAEGEUK_DOT_ORBIT)
    const y = Math.round(TAEGEUK_CENTER.y + Math.sin(angle) * TAEGEUK_DOT_ORBIT)
    return { x, y, red: !taegeukRed(angle, frame) }
  })
}

export function taegeukRows(columns: number, rows: number, style: TaegeukStyle, elapsedMs: number): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const colors = TAEGEUK_COLORS[style]
  const frame = taegeukFrame(elapsedMs)
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
  // Flag-field border framing the emblem.
  const border = TAEGEUK_BORDER
  paint(border.x0, border.y0, "+" + "-".repeat(border.x1 - border.x0 - 1) + "+", colors.ring)
  paint(border.x0, border.y1, "+" + "-".repeat(border.x1 - border.x0 - 1) + "+", colors.ring)
  for (let y = border.y0 + 1; y < border.y1; y++) {
    paint(border.x0, y, "|", colors.ring)
    paint(border.x1, y, "|", colors.ring)
  }
  // Static ray ticks ringing the disc.
  for (let k = 0; k < TAEGEUK_TICKS; k++) {
    const angle = (2 * Math.PI * k) / TAEGEUK_TICKS
    paint(
      Math.round(TAEGEUK_CENTER.x + Math.cos(angle) * (TAEGEUK_RADIUS + 1.5)),
      Math.round(TAEGEUK_CENTER.y + Math.sin(angle) * (TAEGEUK_RADIUS + 1.5)),
      ".",
      colors.ray,
    )
  }
  // Rotating red/blue halves inside a ring.
  for (let y = TAEGEUK_CENTER.y - TAEGEUK_RADIUS; y <= TAEGEUK_CENTER.y + TAEGEUK_RADIUS; y++) {
    for (let x = TAEGEUK_CENTER.x - TAEGEUK_RADIUS; x <= TAEGEUK_CENTER.x + TAEGEUK_RADIUS; x++) {
      const dx = x - TAEGEUK_CENTER.x
      const dy = y - TAEGEUK_CENTER.y
      const dist = Math.hypot(dx, dy)
      if (dist > TAEGEUK_RADIUS) continue
      if (dist > TAEGEUK_RADIUS - 0.8) {
        paint(x, y, "o", colors.ring)
        continue
      }
      const red = taegeukRed(Math.atan2(dy, dx), frame)
      paint(x, y, red ? "@" : "%", red ? colors.red : colors.blue)
    }
  }
  for (const dot of taegeukDots(elapsedMs)) {
    paint(dot.x, dot.y, "o", dot.red ? colors.red : colors.blue)
  }
  // Golden sparks orbiting the disc.
  for (const spark of taegeukSparks(elapsedMs)) {
    paint(spark.x, spark.y, "*", colors.spark)
  }
  // Four trigram corners in ASCII strokes.
  paint(24, 3, "===", colors.trigram)
  paint(24, 4, "===", colors.trigram)
  paint(24, 5, "===", colors.trigram)
  paint(49, 3, "= =", colors.trigram)
  paint(49, 4, "= =", colors.trigram)
  paint(49, 5, "= =", colors.trigram)
  paint(24, 16, "===", colors.trigram)
  paint(24, 17, "= =", colors.trigram)
  paint(24, 18, "===", colors.trigram)
  paint(49, 16, "= =", colors.trigram)
  paint(49, 17, "===", colors.trigram)
  paint(49, 18, "= =", colors.trigram)
  // Floodlight pylons outside the flag field.
  for (const pylon of TAEGEUK_PYLONS) {
    paint(pylon, 14, "o", colors.flood)
    for (let y = 15; y <= 19; y++) {
      paint(pylon, y, "|", colors.ring)
    }
  }
  // Confetti tumbling over the emblem.
  for (const bit of taegeukConfetti(elapsedMs)) {
    paint(bit.x, bit.y, "*", bit.red ? colors.red : colors.blue)
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
