import type { FujiRun } from "./fuji-view-model"

export type CanyonStyle = "canyon-day" | "canyon-night"
export function isCanyonStyle(style: string | undefined): style is CanyonStyle {
  return style === "canyon-day" || style === "canyon-night"
}

/** Reference composition size shared by both renderers. */
export const CANYON_COLUMNS = 76
export const CANYON_ROWS = 24
export const CANYON_STRATA_TOP = 8
export const CANYON_RIVER_TOP = 16
export const CANYON_FLOOR_TOP = 18
export const CANYON_SUN = { x: 12, y: 2 } as const
export const CANYON_MOON = { x: 62, y: 2 } as const
/** Night stars in row-major order, shared by both renderers. */
export const CANYON_STARS = [
  { x: 9, y: 1 },
  { x: 20, y: 3 },
  { x: 33, y: 0 },
  { x: 45, y: 2 },
  { x: 55, y: 5 },
  { x: 70, y: 1 },
] as const
export const CANYON_FIRE = { x: 38, y: 18 } as const
export const CANYON_CYCLE_MS = 2400

/** Palette shared by the text and pixel renderers. */
export const CANYON_COLORS = {
  "canyon-day": {
    sky: "#7ab5d3",
    skyBottom: "#f0d8a8",
    strata1: "#b8683c",
    strata2: "#8a4a30",
    strata3: "#d89858",
    rim: "#5a3428",
    rimBg: "#3a2018",
    rock: "#6a4030",
    water: "#9ad0e8",
    riverBg: "#3a7a9a",
    glint: "#ffffff",
    ground: "#8a5a38",
    sun: "#ffdf6a",
    eagle: "#2c2c3a",
    stone: "#9a9aa8",
    flame: "#ffb14e",
    ash: "#6a6a72",
  },
  "canyon-night": {
    sky: "#8ba0c8",
    skyBottom: "#1c2a55",
    strata1: "#3a2a3a",
    strata2: "#2c2030",
    strata3: "#4a3040",
    rim: "#1c141c",
    rimBg: "#120c12",
    rock: "#2c2028",
    water: "#7a9ac0",
    riverBg: "#16283f",
    glint: "#c8e0f0",
    ground: "#2c2018",
    sun: "#ffdf6a",
    eagle: "#8a8a9a",
    stone: "#5a5a6e",
    flame: "#ff9a3c",
    ash: "#3a3a44",
  },
} as const satisfies Record<CanyonStyle, Record<string, string>>

export function canyonBackground(style: CanyonStyle) {
  return style === "canyon-day" ? "#8ec8e8" : "#0a1030"
}

/** Sample the vertical sky gradient. `t` is 0 at the top of the frame. */
export function canyonSkyRgb(style: CanyonStyle, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(canyonBackground(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(CANYON_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

/** 200ms river beat looping bit-identically with the 2400ms cycle. */
export function canyonTick(elapsedMs: number): number {
  return Math.floor(Math.max(0, elapsedMs) / 200) % 12
}

/** Campfire flames flicker together on a 400ms beat, bright at rest. */
export function canyonFlicker(elapsedMs: number): boolean {
  return Math.floor(Math.max(0, elapsedMs) / 200) % 2 === 0
}

const RIVER = ["~", "~", "=", "~"] as const

export type CanyonEagle = { x: number; y: number }
/** Eagle soaring east across the sky, riding a slow thermal. */
export function canyonEagle(elapsedMs: number): CanyonEagle {
  const phase = (Math.max(0, elapsedMs) % CANYON_CYCLE_MS) / CANYON_CYCLE_MS
  return {
    x: Math.floor(phase * CANYON_COLUMNS) % CANYON_COLUMNS,
    y: 4 + Math.round(Math.sin(2 * Math.PI * phase) * 2),
  }
}

export function canyonRows(width: number, height: number, style: CanyonStyle, elapsedMs: number): FujiRun[][] {
  const w = Math.max(0, Math.floor(width)),
    h = Math.max(0, Math.floor(height))
  const night = style === "canyon-night"
  const colors = CANYON_COLORS[style]
  const tick = canyonTick(elapsedMs)
  const flame = canyonFlicker(elapsedMs)
  const grid: FujiRun[][] = Array.from({ length: h }, () =>
    Array.from({ length: w }, () => ({ text: " ", color: colors.sky })),
  )
  const left = Math.floor((w - CANYON_COLUMNS) / 2),
    top = Math.floor((h - CANYON_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + Math.round(y)
    if (row < 0 || row >= h) return
    for (let i = 0; i < text.length; i++) {
      const sceneX = Math.round(x) + i
      const column = left + sceneX
      if (sceneX < 0 || sceneX >= CANYON_COLUMNS || column < 0 || column >= w) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }
  if (night) {
    CANYON_STARS.forEach((star, i) => {
      paint(star.x, star.y, (Math.floor(Math.max(0, elapsedMs) / 400) + i) % 3 === 0 ? "*" : ".", colors.sky)
    })
    paint(CANYON_MOON.x - 1, CANYON_MOON.y - 1, ".-.", colors.stone)
    paint(CANYON_MOON.x - 2, CANYON_MOON.y, "(   )", colors.stone)
  } else {
    paint(CANYON_SUN.x - 1, CANYON_SUN.y - 1, "\\|/", colors.sun)
    paint(CANYON_SUN.x - 1, CANYON_SUN.y, "-o-", colors.sun)
    paint(CANYON_SUN.x - 1, CANYON_SUN.y + 1, "/|\\", colors.sun)
  }
  // Layered strata bands with rock texture and dark rims.
  const bands = [colors.strata1, colors.strata2, colors.strata3] as const
  for (let y = CANYON_STRATA_TOP; y < CANYON_RIVER_TOP; y++) {
    const band = bands[Math.floor((y - CANYON_STRATA_TOP) / 2) % bands.length]!
    paint(0, y, " ".repeat(CANYON_COLUMNS), colors.rock, band)
    for (let x = 2 + ((y - CANYON_STRATA_TOP) % 3); x < CANYON_COLUMNS; x += 9) {
      paint(x, y, "|", colors.rock, band)
    }
    paint(0, y, "######", colors.rim, colors.rimBg)
    paint(CANYON_COLUMNS - 6, y, "######", colors.rim, colors.rimBg)
  }
  // Glinting river across the canyon floor.
  for (let y = CANYON_RIVER_TOP; y < CANYON_FLOOR_TOP; y++) {
    let line = ""
    for (let x = 0; x < CANYON_COLUMNS; x++) line += RIVER[(x + tick) % RIVER.length]!
    paint(0, y, line, colors.water, colors.riverBg)
  }
  for (let y = CANYON_FLOOR_TOP; y < CANYON_ROWS; y++) {
    paint(0, y, " ".repeat(CANYON_COLUMNS), colors.ground, colors.ground)
  }
  // Campfire ring on the canyon floor, lit only at night.
  paint(CANYON_FIRE.x - 2, CANYON_FIRE.y + 1, "o   o", colors.stone, colors.ground)
  if (night) {
    paint(CANYON_FIRE.x, CANYON_FIRE.y, flame ? "[*]" : "[ ]", flame ? colors.flame : colors.ash, colors.ground)
  } else {
    paint(CANYON_FIRE.x, CANYON_FIRE.y, "[ ]", colors.ash, colors.ground)
  }
  const eagle = canyonEagle(elapsedMs)
  paint(eagle.x, eagle.y, tick % 2 === 0 ? "/v\\" : "\\v/", colors.eagle)
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
