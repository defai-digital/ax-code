import type { FujiRun } from "./fuji-view-model"

export type SnowStyle = "snowfall" | "winter-night"
export function isSnowStyle(style: string | undefined): style is SnowStyle {
  return style === "snowfall" || style === "winter-night"
}

/** Reference composition size shared by both renderers. */
export const SNOW_COLUMNS = 74
export const SNOW_ROWS = 20
export const SNOW_CYCLE_MS = 3000
export const SNOW_BASE = 14
export const SNOW_GROUND_TOP = 16
export const SNOW_PINES = [
  { x: 8, h: 8 },
  { x: 25, h: 11 },
  { x: 46, h: 9 },
  { x: 64, h: 12 },
] as const
export const SNOW_SPARKS = [
  { x: 5, y: 17 },
  { x: 18, y: 18 },
  { x: 33, y: 17 },
  { x: 49, y: 18 },
  { x: 58, y: 17 },
  { x: 69, y: 18 },
] as const
export const SNOW_SUN = { x: 58.5, y: 2 } as const
export const SNOW_MOON = { x: 14.5, y: 2 } as const
/** Distant peaks behind the pines: apex plus slope rows at one cell per row. */
export const SNOW_RIDGE = [
  { ax: 36, ay: 8, rows: 6 },
  { ax: 15, ay: 6, rows: 6 },
  { ax: 56, ay: 9, rows: 4 },
] as const

/** Palette shared by the text and pixel renderers. */
export const SNOW_COLORS = {
  snowfall: {
    sky: "#8a9bb8",
    skyBottom: "#d8e2f0",
    pine: "#2f6b4f",
    pineDeep: "#23563f",
    trunk: "#6b4f3a",
    snow: "#ffffff",
    flake: "#ffffff",
    orb: "#f5e9c8",
    ground: "#eef3fa",
    ridge: "#7c8fb4",
    sparkDim: "#aeb9cc",
  },
  "winter-night": {
    sky: "#8ba0c8",
    skyBottom: "#24385e",
    pine: "#1d4032",
    pineDeep: "#16352a",
    trunk: "#3a2c22",
    snow: "#dfe8f5",
    flake: "#e8eef8",
    orb: "#e8eef8",
    ground: "#7e93b8",
    ridge: "#2c3c60",
    sparkDim: "#4a5a78",
  },
} as const satisfies Record<SnowStyle, Record<string, string>>

export function snowBackground(style: SnowStyle) {
  return style === "snowfall" ? "#7d94b8" : "#0c162e"
}

/** Sample the vertical sky gradient. `t` is 0 at the top of the frame. */
export function snowSkyRgb(style: SnowStyle, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(snowBackground(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(SNOW_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

/** Pine half-width `r` rows below the apex. */
export function snowPineHalf(r: number): number {
  return Math.round((r + 1) * 0.7)
}

export type SnowFlake = { x: number; y: number; char: string }
/**
 * Deterministic snowfall below the celestial band. Positions derive from the
 * cycle phase alone with whole-number drifts, so every render of the same
 * millisecond is identical and the full sky loops with SNOW_CYCLE_MS.
 */
export function snowFlakes(elapsedMs: number): SnowFlake[] {
  const phase = (Math.max(0, elapsedMs) % SNOW_CYCLE_MS) / SNOW_CYCLE_MS
  // Two wind gusts per cycle swell the sideways sway and die back down.
  const gust = 1 + 0.5 * Math.sin(4 * Math.PI * phase)
  return Array.from({ length: 14 }, (_, i) => {
    const y = 3 + ((((i * 17 + 1) % 13) + phase * (8 + (i % 4) * 2)) % 13)
    const sway = (1 + (i % 2)) * Math.sin(2 * Math.PI * (phase * (1 + (i % 2)) + i / 14)) * gust
    const drifted = ((i * 31 + 5) % SNOW_COLUMNS) - phase * (4 + (i % 3) * 3) + sway
    const x = ((drifted % SNOW_COLUMNS) + SNOW_COLUMNS) % SNOW_COLUMNS
    return { x, y, char: i % 5 === 0 ? "@" : i % 3 === 0 ? "*" : "." }
  })
}

/** Ground spark `i` of SNOW_SPARKS glints on a shared 500ms beat. */
export function snowSparkBright(elapsedMs: number, i: number): boolean {
  return (Math.floor(Math.max(0, elapsedMs) / 250) + i) % 2 === 0
}

/** Flake twinkle glyph on a shared 500ms beat; far flakes stay dim. */
export function snowFlakeGlyph(char: string, elapsedMs: number): string {
  const beat = Math.floor(Math.max(0, elapsedMs) / 500) % 2
  if (char === "@") return beat ? "*" : "@"
  if (char === "*") return beat ? "." : "*"
  return char
}

/** Static halo ticks around the sun/moon orb. */
export function snowHaloTicks(style: SnowStyle) {
  const orb = style === "winter-night" ? SNOW_MOON : SNOW_SUN
  const ox = Math.round(orb.x),
    oy = Math.round(orb.y)
  return [
    { x: ox - 4, y: oy },
    { x: ox + 4, y: oy },
    { x: ox, y: oy - 2 },
    { x: ox, y: oy + 2 },
  ]
}

/** Ground shadows pool away from the orb side. */
export function snowShadowDX(style: SnowStyle): number {
  return style === "snowfall" ? -1 : 1
}

export function snowRows(columns: number, rows: number, style: SnowStyle, elapsedMs: number): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const night = style === "winter-night"
  const colors = SNOW_COLORS[style]
  const grid: FujiRun[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: colors.sky })),
  )
  const left = Math.floor((width - SNOW_COLUMNS) / 2),
    top = Math.floor((height - SNOW_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + Math.round(y)
    if (row < 0 || row >= height) return
    for (let i = 0; i < text.length; i++) {
      const sceneX = Math.round(x) + i
      const column = left + sceneX
      if (sceneX < 0 || sceneX >= SNOW_COLUMNS || column < 0 || column >= width) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }
  const orb = night ? SNOW_MOON : SNOW_SUN
  if (night) {
    paint(3, 0, ".    *      .       *      .", colors.sky)
    paint(28, 1, "*      .      *", colors.sky)
    paint(45, 1, ".      *", colors.sky)
  }
  paint(Math.round(orb.x) - 2, Math.round(orb.y) - 1, ".-.", colors.orb)
  paint(Math.round(orb.x) - 3, Math.round(orb.y), "(   )", colors.orb)
  for (const tick of snowHaloTicks(style)) {
    paint(tick.x, tick.y, ".", colors.orb)
  }
  paint(0, SNOW_GROUND_TOP, " ".repeat(SNOW_COLUMNS), colors.ground, colors.ground)
  for (let y = SNOW_GROUND_TOP + 1; y < SNOW_ROWS; y++) {
    paint(0, y, " ".repeat(SNOW_COLUMNS), colors.ground, colors.ground)
  }
  const shadowDX = snowShadowDX(style)
  for (const pine of SNOW_PINES) {
    paint(pine.x - 4 + shadowDX, SNOW_GROUND_TOP + 1, " ".repeat(9), colors.sparkDim, colors.sparkDim)
    paint(pine.x - 2 + shadowDX, SNOW_GROUND_TOP + 2, " ".repeat(5), colors.sparkDim, colors.sparkDim)
  }
  SNOW_SPARKS.forEach((spark, i) => {
    const glint = snowSparkBright(elapsedMs, i)
    paint(spark.x, spark.y, glint ? "*" : ".", glint ? colors.snow : colors.sparkDim, colors.ground)
  })
  for (const peak of SNOW_RIDGE) {
    paint(peak.ax, peak.ay, "*", colors.snow)
    for (let dy = 1; dy <= peak.rows; dy++) {
      paint(peak.ax - dy, peak.ay + dy, "/", colors.ridge)
      paint(peak.ax + dy, peak.ay + dy, "\\", colors.ridge)
    }
  }
  for (const pine of SNOW_PINES) {
    const apex = SNOW_BASE - pine.h + 1
    for (let r = 0; r < pine.h; r++) {
      const half = snowPineHalf(r)
      const edge = r % 2 === 0 ? colors.snow : colors.pine
      paint(pine.x - half, apex + r, "/", edge, colors.pine)
      paint(pine.x - half + 1, apex + r, " ".repeat(Math.max(0, half * 2 - 1)), colors.pineDeep, colors.pineDeep)
      paint(pine.x + half, apex + r, "\\", edge, colors.pine)
    }
    paint(pine.x, apex, "*", colors.snow, colors.pine)
    paint(pine.x - 2, apex + 3, "*", colors.snow, colors.pine)
    paint(pine.x + 2, apex + 5, "*", colors.snow, colors.pine)
    paint(pine.x - 3, apex + 6, "*", colors.snow, colors.pine)
    paint(pine.x + 3, apex + 7, "*", colors.snow, colors.pine)
    paint(pine.x - 1, SNOW_BASE + 1, "||", colors.trunk)
    paint(pine.x - 1, SNOW_BASE + 2, "||", colors.trunk)
  }
  for (const flake of snowFlakes(elapsedMs)) {
    paint(flake.x, flake.y, snowFlakeGlyph(flake.char, elapsedMs), colors.flake)
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
