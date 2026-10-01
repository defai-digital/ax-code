import type { FujiRun } from "./fuji-view-model"

export type AuroraStyle = "aurora-night" | "aurora-dawn"
export function isAuroraStyle(style: string | undefined): style is AuroraStyle {
  return style === "aurora-night" || style === "aurora-dawn"
}

/** Reference composition size shared by both renderers. */
export const AURORA_COLUMNS = 76
export const AURORA_ROWS = 24
export const AURORA_CURTAINS = [15, 38, 58] as const
export const AURORA_CURTAIN_WIDTH = 8
export const AURORA_CURTAIN_TOP = 0
export const AURORA_CURTAIN_BOTTOM = 10
export const AURORA_HORIZON = 13
export const AURORA_TREELINE = 14
export const AURORA_PINES = [5, 11, 24, 31, 46, 52, 65, 71] as const
export const AURORA_LAKE_TOP = 18
export const AURORA_MIST_ROW = 17
export const AURORA_MOON = { x: 66, y: 2 } as const
/** Night stars in row-major order, shared by both renderers. */
export const AURORA_STARS = [
  { x: 3, y: 1 },
  { x: 27, y: 0 },
  { x: 48, y: 1 },
  { x: 55, y: 3 },
  { x: 70, y: 5 },
  { x: 8, y: 6 },
] as const
export const AURORA_CYCLE_MS = 2400

/** Palette shared by the text and pixel renderers. */
export const AURORA_COLORS = {
  "aurora-night": {
    sky: "#8ba0c8",
    skyBottom: "#16224a",
    curtain: "#4de8a8",
    curtainEdge: "#b8ffe0",
    star: "#e8ecf8",
    moon: "#e8e8f2",
    pine: "#1e4a2e",
    trunk: "#2c2418",
    snow: "#c8d8e8",
    water: "#5a7aa8",
    waterDeep: "#1b3252",
    shimmer: "#4de8a8",
  },
  "aurora-dawn": {
    sky: "#c8a8b8",
    skyBottom: "#f2c8a8",
    curtain: "#7ac8b8",
    curtainEdge: "#e8fff4",
    star: "#f2e8f2",
    moon: "#f2e8dc",
    pine: "#2e5a3e",
    trunk: "#4a3a28",
    snow: "#f2e8e0",
    water: "#a88aa8",
    waterDeep: "#4a3a58",
    shimmer: "#7ac8b8",
  },
} as const satisfies Record<AuroraStyle, Record<string, string>>

export function auroraBackground(style: AuroraStyle) {
  return style === "aurora-night" ? "#0a1230" : "#3a4a6e"
}

/** Sample the vertical sky gradient. `t` is 0 at the top of the frame. */
export function auroraSkyRgb(style: AuroraStyle, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(auroraBackground(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(AURORA_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

/** Ripple offset of the aurora curtains. Loops bit-identically with the cycle. */
export function auroraRipple(elapsedMs: number, x: number): number {
  const phase = (Math.max(0, elapsedMs) % AURORA_CYCLE_MS) / AURORA_CYCLE_MS
  return Math.sin(2 * Math.PI * (phase + x / AURORA_COLUMNS)) * 2
}

/** Lake shimmer beat, bright at rest. */
export function auroraShimmer(elapsedMs: number): boolean {
  return Math.floor(Math.max(0, elapsedMs) / 200) % 2 === 0
}

export function auroraRows(columns: number, rows: number, style: AuroraStyle, elapsedMs: number): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const dawn = style === "aurora-dawn"
  const colors = AURORA_COLORS[style]
  const bright = auroraShimmer(elapsedMs)
  const grid: FujiRun[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: colors.sky })),
  )
  const left = Math.floor((width - AURORA_COLUMNS) / 2),
    top = Math.floor((height - AURORA_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + Math.round(y)
    if (row < 0 || row >= height) return
    for (let i = 0; i < text.length; i++) {
      const sceneX = Math.round(x) + i
      const column = left + sceneX
      if (sceneX < 0 || sceneX >= AURORA_COLUMNS || column < 0 || column >= width) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }
  if (!dawn) {
    AURORA_STARS.forEach((star, i) => {
      paint(star.x, star.y, (Math.floor(Math.max(0, elapsedMs) / 400) + i) % 3 === 0 ? "*" : ".", colors.star)
    })
    paint(AURORA_MOON.x - 1, AURORA_MOON.y - 1, ".-.", colors.moon)
    paint(AURORA_MOON.x - 2, AURORA_MOON.y, "(   )", colors.moon)
  }
  // Rippling aurora curtains, fainter and lower at dawn.
  const curtainBottom = dawn ? AURORA_CURTAIN_BOTTOM - 3 : AURORA_CURTAIN_BOTTOM
  for (const center of AURORA_CURTAINS) {
    for (let dx = -AURORA_CURTAIN_WIDTH / 2; dx < AURORA_CURTAIN_WIDTH / 2; dx++) {
      const sway = Math.round(auroraRipple(elapsedMs, center + dx))
      const edge = Math.abs(dx) >= AURORA_CURTAIN_WIDTH / 2 - 1
      const glyph = dawn ? (edge ? "." : ":") : edge ? "|" : "#"
      const color = edge ? colors.curtainEdge : colors.curtain
      for (let y = AURORA_CURTAIN_TOP; y <= curtainBottom; y++) {
        if ((y + Math.round(center) + dx) % (dawn ? 4 : 3) === 0) continue
        paint(center + dx + sway, y, glyph, color)
      }
    }
  }
  // Rose horizon band at dawn.
  if (dawn) {
    paint(0, AURORA_HORIZON, "=".repeat(AURORA_COLUMNS), colors.skyBottom)
  }
  // Snowy treeline with dark trunks.
  for (const pine of AURORA_PINES) {
    paint(pine, AURORA_TREELINE, "/\\", colors.snow)
    paint(pine - 1, AURORA_TREELINE + 1, "/||\\", colors.pine)
    paint(pine - 1, AURORA_TREELINE + 2, "/||\\", colors.pine)
    paint(pine, AURORA_TREELINE + 2, "||", colors.trunk)
  }
  // Low mist drifting over the shore.
  const phase = (Math.max(0, elapsedMs) % AURORA_CYCLE_MS) / AURORA_CYCLE_MS
  const drift = Math.floor(phase * AURORA_COLUMNS)
  for (let x = 0; x < AURORA_COLUMNS; x += 9) {
    const mx = (x + drift) % AURORA_COLUMNS
    paint(mx, AURORA_MIST_ROW, "~~~", colors.snow)
  }
  // Frozen lake with curtain reflections shimmering below each band.
  for (let y = AURORA_LAKE_TOP; y < AURORA_ROWS; y++) {
    paint(0, y, " ".repeat(AURORA_COLUMNS), colors.water, y % 2 === 0 ? colors.water : colors.waterDeep)
  }
  for (const center of AURORA_CURTAINS) {
    const sway = Math.round(auroraRipple(elapsedMs, center))
    paint(center - 2 + sway, AURORA_LAKE_TOP + 1, bright ? "=====" : "-----", colors.shimmer, colors.waterDeep)
    paint(center - 1 + sway, AURORA_LAKE_TOP + 3, bright ? "===" : "---", colors.shimmer, colors.waterDeep)
  }
  // Ice cracks across the near shore.
  for (let x = 4; x < AURORA_COLUMNS; x += 17) {
    paint(x, AURORA_LAKE_TOP + 5, "/ \\", colors.snow, colors.waterDeep)
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
