import type { FujiRun } from "./fuji-view-model"

export type FallsStyle = "falls-day" | "falls-moon"
export function isFallsStyle(style: string | undefined): style is FallsStyle {
  return style === "falls-day" || style === "falls-moon"
}

/** Reference composition size shared by both renderers. */
export const FALLS_COLUMNS = 76
export const FALLS_ROWS = 24
/** Gorge walls run to the frame edges and step up away from the falls. */
export const FALLS_CLIFF_LEFT = { x0: 0, x1: 31, top: 3, base: 16 } as const
export const FALLS_CLIFF_RIGHT = { x0: 44, x1: 75, top: 3, base: 16 } as const
/** Continuous cliff crest row for a scene column: low at the lip, rising outward. */
export function fallsCliffTopF(x: number): number {
  const d = x < 32 ? 31 - x : x - 44
  const rise = Math.min(1, Math.max(0, d) / 24)
  const wobble = Math.sin(x * 0.83 + 1.3) * 0.45 + Math.sin(x * 0.37) * 0.35
  return 6.6 - rise * 3.2 + wobble
}
export const FALLS_FALLS = { x0: 32, x1: 43, top: 6, base: 16 } as const
export const FALLS_POOL_TOP = 17
export const FALLS_GROUND_TOP = 20
export const FALLS_MOON = { x: 62, y: 2 } as const
/** Night stars in row-major order, shared by both renderers. */
export const FALLS_STARS = [
  { x: 4, y: 0 },
  { x: 14, y: 3 },
  { x: 27, y: 1 },
  { x: 50, y: 0 },
  { x: 58, y: 4 },
  { x: 71, y: 2 },
] as const
export const FALLS_MIST_COUNT = 8
export const FALLS_FIREFLY_COUNT = 6
export const FALLS_CYCLE_MS = 2400

/** Palette shared by the text and pixel renderers. */
export const FALLS_COLORS = {
  "falls-day": {
    sky: "#7ab5d3",
    skyBottom: "#dcefe8",
    cliff: "#6a6a72",
    cliffBg: "#4a4a55",
    water: "#e8f4fa",
    waterBg: "#3a7a9a",
    pool: "#c8e4f0",
    poolBg: "#2a6a8a",
    mist: "#f0f8fc",
    rainbow1: "#e05a4a",
    rainbow2: "#e8a83c",
    rainbow3: "#4a9a5a",
    ground: "#3d6a3d",
    grass: "#5a9a4a",
    glow: "#ffffa8",
  },
  "falls-moon": {
    sky: "#8ba0c8",
    skyBottom: "#1c2a55",
    cliff: "#3a3a48",
    cliffBg: "#23232e",
    water: "#a8c8e0",
    waterBg: "#1e3a5a",
    pool: "#7a9ac0",
    poolBg: "#16283f",
    mist: "#b8d4e8",
    rainbow1: "#5a3a3a",
    rainbow2: "#5a4a2c",
    rainbow3: "#2c4a3a",
    ground: "#16281a",
    grass: "#2c4a2c",
    glow: "#ffe86a",
  },
} as const satisfies Record<FallsStyle, Record<string, string>>

export function fallsBackground(style: FallsStyle) {
  return style === "falls-day" ? "#8ec8e8" : "#0a1030"
}

/** Sample the vertical sky gradient. `t` is 0 at the top of the frame. */
export function fallsSkyRgb(style: FallsStyle, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(fallsBackground(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(FALLS_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

/** 200ms water beat looping bit-identically with the 2400ms cycle. */
export function fallsTick(elapsedMs: number): number {
  return Math.floor(Math.max(0, elapsedMs) / 200) % 12
}

const FLOW = ["|", ":", "|", "!"] as const

export type FallsMist = { x: number; y: number }
/** Mist puffs drifting over the pool, looping with the 2400ms cycle. */
export function fallsMist(elapsedMs: number): FallsMist[] {
  const phase = (Math.max(0, elapsedMs) % FALLS_CYCLE_MS) / FALLS_CYCLE_MS
  return Array.from({ length: FALLS_MIST_COUNT }, (_, i) => {
    const y = 15 + Math.floor((((i * 5 + 1) % 3) + phase * 3) % 3)
    const x = 28 + Math.floor((((i * 11 + 3) % 21) + phase * 21) % 21)
    return { x, y }
  })
}

export type FallsFirefly = { x: number; y: number }
/** Moonlit fireflies wandering above the pool and banks. */
export function fallsFireflies(elapsedMs: number): FallsFirefly[] {
  const phase = (Math.max(0, elapsedMs) % FALLS_CYCLE_MS) / FALLS_CYCLE_MS
  return Array.from({ length: FALLS_FIREFLY_COUNT }, (_, i) => {
    const sway = Math.sin(2 * Math.PI * (phase + i / FALLS_FIREFLY_COUNT)) * 2
    const drifted = 24 + ((i * 17 + 5) % 28) + phase * 6 + sway
    const x = 24 + ((((Math.floor(drifted) - 24) % 28) + 28) % 28)
    const y = 17 + ((i + Math.floor(phase * 12)) % 4)
    return { x, y }
  })
}

export function fallsRows(width: number, height: number, style: FallsStyle, elapsedMs: number): FujiRun[][] {
  const w = Math.max(0, Math.floor(width)),
    h = Math.max(0, Math.floor(height))
  const night = style === "falls-moon"
  const colors = FALLS_COLORS[style]
  const tick = fallsTick(elapsedMs)
  const grid: FujiRun[][] = Array.from({ length: h }, () =>
    Array.from({ length: w }, () => ({ text: " ", color: colors.sky })),
  )
  const left = Math.floor((w - FALLS_COLUMNS) / 2),
    top = Math.floor((h - FALLS_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + Math.round(y)
    if (row < 0 || row >= h) return
    for (let i = 0; i < text.length; i++) {
      const sceneX = Math.round(x) + i
      const column = left + sceneX
      if (sceneX < 0 || sceneX >= FALLS_COLUMNS || column < 0 || column >= w) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }
  if (night) {
    FALLS_STARS.forEach((star, i) => {
      paint(star.x, star.y, (Math.floor(Math.max(0, elapsedMs) / 400) + i) % 3 === 0 ? "*" : ".", colors.sky)
    })
    paint(FALLS_MOON.x - 1, FALLS_MOON.y - 1, ".-.", colors.cliff)
    paint(FALLS_MOON.x - 2, FALLS_MOON.y, "(   )", colors.cliff)
  }
  // Cliffs flanking the falls.
  for (const cliff of [FALLS_CLIFF_LEFT, FALLS_CLIFF_RIGHT]) {
    for (let x = cliff.x0; x <= cliff.x1; x++) {
      for (let y = Math.max(cliff.top, Math.round(fallsCliffTopF(x))); y <= cliff.base; y++) {
        paint(x, y, "#", colors.cliff, colors.cliffBg)
      }
    }
  }
  // Falling water cycling through flow glyphs.
  const falls = FALLS_FALLS
  for (let y = falls.top; y <= falls.base; y++) {
    const glyph = FLOW[(y + tick) % FLOW.length]!
    paint(falls.x0, y, glyph.repeat(falls.x1 - falls.x0 + 1), colors.water, colors.waterBg)
  }
  // Faint rainbow arcing beside the falls by day.
  if (!night) {
    paint(48, 13, "(", colors.rainbow1)
    paint(54, 13, ")", colors.rainbow1)
    paint(47, 14, "(", colors.rainbow2)
    paint(55, 14, ")", colors.rainbow2)
    paint(46, 15, "(", colors.rainbow3)
    paint(56, 15, ")", colors.rainbow3)
  }
  for (let y = FALLS_POOL_TOP; y < FALLS_GROUND_TOP; y++) {
    paint(0, y, "~".repeat(FALLS_COLUMNS), colors.pool, colors.poolBg)
  }
  for (let y = FALLS_GROUND_TOP; y < FALLS_ROWS; y++) {
    paint(0, y, " ".repeat(FALLS_COLUMNS), colors.ground, colors.ground)
  }
  for (let x = 1; x < FALLS_COLUMNS; x += 6) {
    paint(x, FALLS_GROUND_TOP + 1, '"', colors.grass, colors.ground)
  }
  // Mist drifts in front of the pool; it keeps the cell background.
  for (const puff of fallsMist(elapsedMs)) {
    const row = top + puff.y
    if (row < 0 || row >= h) continue
    const column = left + puff.x
    if (puff.x < 0 || puff.x >= FALLS_COLUMNS || column < 0 || column >= w) continue
    const cell = grid[row]![column]!
    grid[row]![column] = { text: ".", color: colors.mist, background: cell.background }
  }
  if (night) {
    for (const fly of fallsFireflies(elapsedMs)) {
      const row = top + fly.y
      if (row < 0 || row >= h) continue
      const column = left + fly.x
      if (fly.x < 0 || fly.x >= FALLS_COLUMNS || column < 0 || column >= w) continue
      const cell = grid[row]![column]!
      grid[row]![column] = { text: "*", color: colors.glow, background: cell.background }
    }
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
