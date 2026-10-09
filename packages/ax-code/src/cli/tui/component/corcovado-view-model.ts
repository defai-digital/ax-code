import type { FujiRun } from "./fuji-view-model"

export type CorcovadoStyle = "corcovado-day" | "corcovado-gold"
export function isCorcovadoStyle(style: string | undefined): style is CorcovadoStyle {
  return style === "corcovado-day" || style === "corcovado-gold"
}

/** Reference composition size shared by both renderers. */
export const CORCOVADO_COLUMNS = 76
export const CORCOVADO_ROWS = 24
export const CORCOVADO_PEAK = { x: 38, top: 6, base: 17 } as const
export const CORCOVADO_STATUE = { x: 38, head: 2, arms: 3, base: 6 } as const
export const CORCOVADO_GROUND_TOP = 19
export const CORCOVADO_CLOUD_COUNT = 6
export const CORCOVADO_SUGARLOAF = { x0: 10, x1: 16, top: 12, base: 14 } as const
export const CORCOVADO_CABLE_ROW = 11
export const CORCOVADO_CABLE_X0 = 2
export const CORCOVADO_CABLE_X1 = 13
export const CORCOVADO_GULL_COUNT = 3
/** Beach umbrellas along the promenade. */
export const CORCOVADO_UMBRELLAS = [8, 30, 55] as const

/** Palette shared by the text and pixel renderers. */
export const CORCOVADO_COLORS = {
  "corcovado-day": {
    sky: "#6aaed6",
    skyBottom: "#d8ecf5",
    rock: "#5a6a72",
    rockDark: "#37424a",
    statue: "#d8dce2",
    statueShade: "#9aa2ae",
    forest: "#2c5a34",
    forestDeep: "#1e3a24",
    lights: "#ffe14e",
    foam: "#ffffff",
    sugarloaf: "#4a5a68",
    sail: "#e8ecf8",
    cloud: "#ffffff",
    sea: "#3d7a9a",
    ground: "#3d5a3d",
    glider: "#c33d4e",
  },
  "corcovado-gold": {
    sky: "#c38a5a",
    skyBottom: "#f2c87a",
    rock: "#4a3d42",
    rockDark: "#2c2428",
    statue: "#ffe9b0",
    statueShade: "#c39a5a",
    forest: "#3d4a2a",
    forestDeep: "#2a3320",
    lights: "#ffd166",
    foam: "#ffd8a8",
    sugarloaf: "#5a4a42",
    sail: "#ffe9b0",
    cloud: "#ffd8a8",
    sea: "#7a5a3a",
    ground: "#3d3226",
    glider: "#7a2a3a",
  },
} as const satisfies Record<CorcovadoStyle, Record<string, string>>

export function corcovadoBackground(style: CorcovadoStyle) {
  return style === "corcovado-day" ? "#7ec0e4" : "#a86a4a"
}

/** Sample the vertical sky gradient. `t` is 0 at the top of the frame. */
export function corcovadoSkyRgb(style: CorcovadoStyle, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(corcovadoBackground(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(CORCOVADO_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

/** Clouds swirling around the peak on a 4800ms round. */
export function corcovadoClouds(elapsedMs: number): { x: number; y: number }[] {
  const t = Math.max(0, elapsedMs)
  return Array.from({ length: CORCOVADO_CLOUD_COUNT }, (_, i) => {
    const angle = (2 * Math.PI * (t / 4800 + i / CORCOVADO_CLOUD_COUNT)) % (2 * Math.PI)
    return {
      x: Math.round(CORCOVADO_PEAK.x + Math.cos(angle) * 22 - 3),
      y: Math.round(9 + Math.sin(angle) * 3),
    }
  })
}

/** Surf phase 0..3 advancing every 300ms. */
export function corcovadoSurf(elapsedMs: number): number {
  return Math.floor(Math.max(0, elapsedMs) / 300) % 4
}

/** Sailboat lane position looping across the bay on a 9600ms round. */
export function corcovadoSail(elapsedMs: number): number {
  return ((Math.max(0, elapsedMs) / 100) % 96) - 10
}

export type CorcovadoGlider = { x: number; y: number }
/** Two hang gliders soaring opposite loops off the peak. */
export function corcovadoGliders(elapsedMs: number): CorcovadoGlider[] {
  const t = Math.max(0, elapsedMs) / 1200
  return [0, 1].map((i) => ({
    x: 38 + Math.round(Math.cos(t + i * Math.PI) * 24),
    y: 7 + Math.round(Math.sin(t + i * Math.PI) * 2),
  }))
}

export type CorcovadoGull = { x: number; y: number }
/** Seagulls crossing the bay. */
export function corcovadoGulls(elapsedMs: number): CorcovadoGull[] {
  const step = Math.floor(Math.max(0, elapsedMs) / 300) * 2
  return Array.from({ length: CORCOVADO_GULL_COUNT }, (_, i) => ({
    x: (i * 25 + 10 + step) % (CORCOVADO_COLUMNS + 8),
    y: 5 + (i % 2),
  }))
}

/** Cable-car position gliding up to Sugarloaf. */
export function corcovadoCable(elapsedMs: number): number {
  return CORCOVADO_CABLE_X0 + (Math.floor(Math.max(0, elapsedMs) / 200) % 12)
}

/** Peak half-width at scene row `y`. */
export function corcovadoHalf(y: number): number {
  const peak = CORCOVADO_PEAK
  return 3 + Math.floor(((y - peak.top) / (peak.base - peak.top)) * 20)
}

export function corcovadoRows(columns: number, rows: number, style: CorcovadoStyle, elapsedMs: number): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const gold = style === "corcovado-gold"
  const colors = CORCOVADO_COLORS[style]
  const surf = corcovadoSurf(elapsedMs)
  const sailX = Math.round(corcovadoSail(elapsedMs))
  const grid: FujiRun[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: colors.sky })),
  )
  const left = Math.floor((width - CORCOVADO_COLUMNS) / 2),
    top = Math.floor((height - CORCOVADO_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + Math.round(y)
    if (row < 0 || row >= height) return
    for (let i = 0; i < text.length; i++) {
      const sceneX = Math.round(x) + i
      const column = left + sceneX
      if (sceneX < 0 || sceneX >= CORCOVADO_COLUMNS || column < 0 || column >= width) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }
  // Sugarloaf dome across the bay.
  const loaf = CORCOVADO_SUGARLOAF
  paint(loaf.x0 + 1, loaf.top, "/--\\", colors.sugarloaf)
  for (let y = loaf.top + 1; y <= loaf.base; y++) {
    paint(loaf.x0, y, " ".repeat(loaf.x1 - loaf.x0 + 1), colors.sugarloaf, colors.sugarloaf)
  }
  // Cable line up to Sugarloaf with its gliding car.
  paint(
    CORCOVADO_CABLE_X0,
    CORCOVADO_CABLE_ROW,
    "-".repeat(CORCOVADO_CABLE_X1 - CORCOVADO_CABLE_X0 + 1),
    colors.rockDark,
  )
  paint(corcovadoCable(elapsedMs), CORCOVADO_CABLE_ROW, "[]", colors.statue)
  // Granite peak widening to the shore.
  const peak = CORCOVADO_PEAK
  for (let y = peak.top; y <= peak.base; y++) {
    const half = corcovadoHalf(y)
    paint(peak.x - half, y, "/" + " ".repeat(half * 2 - 1) + "\\", colors.rockDark, colors.rock)
  }
  // Forest stipple over the slopes.
  for (let y = 9; y <= 16; y++) {
    const half = corcovadoHalf(y)
    for (let x = peak.x - half + 2; x <= peak.x + half - 2; x++) {
      const hash = (x * 7 + y * 3) % 5
      if (hash < 2) paint(x, y, ".", hash === 0 ? colors.forest : colors.forestDeep, colors.rock)
    }
  }
  // Open-armed statue on the summit.
  const statue = CORCOVADO_STATUE
  paint(statue.x, statue.head, "o", colors.statueShade, colors.statue)
  paint(statue.x - 5, statue.arms, "_".repeat(5) + "|" + "_".repeat(5), colors.statueShade)
  for (let y = statue.arms + 1; y <= statue.base; y++) {
    paint(statue.x, y, "|", colors.statueShade, colors.statue)
  }
  for (const cloud of corcovadoClouds(elapsedMs)) {
    paint(cloud.x, cloud.y, "~~~~~~", colors.cloud)
  }
  // Hang gliders soaring off the peak.
  for (const glider of corcovadoGliders(elapsedMs)) {
    paint(glider.x, glider.y, "V", colors.glider)
  }
  // Seagulls crossing the bay.
  for (const gull of corcovadoGulls(elapsedMs)) {
    paint(gull.x, gull.y, "v", colors.foam)
  }
  // Shoreline cottages: lamps at gold, spray by day.
  for (let x = 2; x < CORCOVADO_COLUMNS; x += 5) {
    paint(x, CORCOVADO_GROUND_TOP - 1, ".", gold ? colors.lights : colors.foam)
  }
  paint(0, CORCOVADO_GROUND_TOP, "~".repeat(CORCOVADO_COLUMNS), colors.sea, colors.sea)
  for (let x = 0; x < CORCOVADO_COLUMNS; x++) {
    if ((x + surf * 2) % 8 === 0) paint(x, CORCOVADO_GROUND_TOP, "~", colors.foam, colors.sea)
  }
  // Lone sailboat crossing the bay.
  paint(sailX, 17, "/\\", colors.sail)
  paint(sailX, 18, "||", colors.sail)
  paint(sailX - 1, CORCOVADO_GROUND_TOP, "\\_/", colors.sail, colors.sea)
  for (let y = CORCOVADO_GROUND_TOP + 1; y < CORCOVADO_ROWS; y++) {
    paint(0, y, " ".repeat(CORCOVADO_COLUMNS), colors.ground, colors.ground)
  }
  // Wave-patterned promenade with beach umbrellas.
  for (let x = 0; x < CORCOVADO_COLUMNS; x++) {
    paint(x, CORCOVADO_GROUND_TOP + 1, x % 8 < 4 ? "~" : "=", colors.sea, colors.ground)
  }
  for (const shade of CORCOVADO_UMBRELLAS) {
    paint(shade, CORCOVADO_GROUND_TOP + 1, "/\\", colors.lights, colors.ground)
    paint(shade, CORCOVADO_GROUND_TOP + 2, "|", colors.lights, colors.ground)
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
