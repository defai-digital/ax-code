import type { FujiRun } from "./fuji-view-model"

export type SteppeStyle = "steppe-day" | "steppe-night"
export function isSteppeStyle(style: string | undefined): style is SteppeStyle {
  return style === "steppe-day" || style === "steppe-night"
}

/** Reference composition size shared by both renderers. */
export const STEPPE_COLUMNS = 76
export const STEPPE_ROWS = 24
export const STEPPE_GROUND_TOP = 16
export const STEPPE_YURT = { x0: 52, x1: 60, top: 12, base: 15 } as const
export const STEPPE_SMOKE_X = 56
export const STEPPE_MOON = { x: 66, y: 2 } as const
/** Night stars in row-major order, shared by both renderers. */
export const STEPPE_STARS = [
  { x: 4, y: 0 },
  { x: 16, y: 3 },
  { x: 28, y: 1 },
  { x: 44, y: 0 },
  { x: 56, y: 5 },
  { x: 72, y: 3 },
] as const
export const STEPPE_CLOUD_COUNT = 3
export const STEPPE_HERD_COUNT = 4
export const STEPPE_CYCLE_MS = 2400

/** Palette shared by the text and pixel renderers. */
export const STEPPE_COLORS = {
  "steppe-day": {
    sky: "#6aa8d0",
    skyBottom: "#e8f4e0",
    cloud: "#f4fafc",
    ground: "#5a8a4a",
    grass: "#3d6a3d",
    herd: "#4a3428",
    yurt: "#d8c8a8",
    yurtBg: "#a89068",
    door: "#5a4028",
    smoke: "#c8c8c8",
    glow: "#ffdf6a",
  },
  "steppe-night": {
    sky: "#8ba0c8",
    skyBottom: "#1c2a55",
    cloud: "#2c3a5e",
    ground: "#16281a",
    grass: "#2c4a2c",
    herd: "#1c1414",
    yurt: "#6a6258",
    yurtBg: "#4a443c",
    door: "#241c14",
    smoke: "#5a5a6e",
    glow: "#ffca4a",
  },
} as const satisfies Record<SteppeStyle, Record<string, string>>

export function steppeBackground(style: SteppeStyle) {
  return style === "steppe-day" ? "#7ec0e8" : "#0a1030"
}

/** Sample the vertical sky gradient. `t` is 0 at the top of the frame. */
export function steppeSkyRgb(style: SteppeStyle, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(steppeBackground(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(STEPPE_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

/** 200ms beat for smoke and gallop legs, looping with the 2400ms cycle. */
export function steppeTick(elapsedMs: number): number {
  return Math.floor(Math.max(0, elapsedMs) / 200) % 12
}

const SMOKE = ["~", ":", "~", "."] as const
const CLOUD_BASES = [10, 40, 60] as const
const CLOUD_ROWS = [2, 3, 4] as const
const HERD_BASES = [8, 20, 32, 44] as const

export type SteppeCloud = { x: number; y: number }
/** Clouds drifting west, wrapping around the 76-cell sky. */
export function steppeClouds(elapsedMs: number): SteppeCloud[] {
  const phase = (Math.max(0, elapsedMs) % STEPPE_CYCLE_MS) / STEPPE_CYCLE_MS
  return Array.from({ length: STEPPE_CLOUD_COUNT }, (_, i) => {
    const drifted = CLOUD_BASES[i]! - Math.floor(phase * STEPPE_COLUMNS)
    const x = ((drifted % STEPPE_COLUMNS) + STEPPE_COLUMNS) % STEPPE_COLUMNS
    return { x, y: CLOUD_ROWS[i]! }
  })
}

export type SteppeHorse = { x: number }
/** Galloping herd crossing the grassland from west to east. */
export function steppeHerd(elapsedMs: number): SteppeHorse[] {
  const phase = (Math.max(0, elapsedMs) % STEPPE_CYCLE_MS) / STEPPE_CYCLE_MS
  return Array.from({ length: STEPPE_HERD_COUNT }, (_, i) => ({
    x: (HERD_BASES[i]! + Math.floor(phase * STEPPE_COLUMNS)) % STEPPE_COLUMNS,
  }))
}

export function steppeRows(width: number, height: number, style: SteppeStyle, elapsedMs: number): FujiRun[][] {
  const w = Math.max(0, Math.floor(width)),
    h = Math.max(0, Math.floor(height))
  const night = style === "steppe-night"
  const colors = STEPPE_COLORS[style]
  const tick = steppeTick(elapsedMs)
  const grid: FujiRun[][] = Array.from({ length: h }, () =>
    Array.from({ length: w }, () => ({ text: " ", color: colors.sky })),
  )
  const left = Math.floor((w - STEPPE_COLUMNS) / 2),
    top = Math.floor((h - STEPPE_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + Math.round(y)
    if (row < 0 || row >= h) return
    for (let i = 0; i < text.length; i++) {
      const sceneX = Math.round(x) + i
      const column = left + sceneX
      if (sceneX < 0 || sceneX >= STEPPE_COLUMNS || column < 0 || column >= w) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }
  if (night) {
    STEPPE_STARS.forEach((star, i) => {
      paint(star.x, star.y, (Math.floor(Math.max(0, elapsedMs) / 400) + i) % 3 === 0 ? "*" : ".", colors.sky)
    })
    paint(STEPPE_MOON.x - 1, STEPPE_MOON.y - 1, ".-.", colors.smoke)
    paint(STEPPE_MOON.x - 2, STEPPE_MOON.y, "(   )", colors.smoke)
  }
  for (const cloud of steppeClouds(elapsedMs)) {
    paint(cloud.x, cloud.y, "(~~~)", colors.cloud)
  }
  for (let y = STEPPE_GROUND_TOP; y < STEPPE_ROWS; y++) {
    paint(0, y, " ".repeat(STEPPE_COLUMNS), colors.ground, colors.ground)
  }
  paint(0, STEPPE_GROUND_TOP, "_".repeat(STEPPE_COLUMNS), colors.grass, colors.ground)
  for (let x = 1; x < STEPPE_COLUMNS; x += 5) {
    paint(x, STEPPE_GROUND_TOP + 3, '"', colors.grass, colors.ground)
    paint(x + 2, STEPPE_GROUND_TOP + 5, '"', colors.grass, colors.ground)
  }
  // Yurt with a felt dome, door, and one window.
  const yurt = STEPPE_YURT
  paint(yurt.x0, yurt.top, "/-----\\", colors.yurt)
  for (let y = yurt.top + 1; y <= yurt.base; y++) {
    paint(yurt.x0, y, "|       |", colors.yurt, colors.yurtBg)
  }
  paint(55, yurt.top + 2, "[]", colors.door, colors.yurtBg)
  paint(55, yurt.top + 3, "[]", colors.door, colors.yurtBg)
  paint(57, yurt.top + 1, night ? "[*]" : "[ ]", night ? colors.glow : colors.door, colors.yurtBg)
  // Smoke curling from the yurt chimney.
  for (let y = 8; y <= 11; y++) {
    paint(STEPPE_SMOKE_X, y, SMOKE[(y + tick) % SMOKE.length]!, colors.smoke)
  }
  // The herd gallops in front of the grassland.
  for (const horse of steppeHerd(elapsedMs)) {
    paint(horse.x, STEPPE_GROUND_TOP - 2, "o>", colors.herd)
    paint(horse.x, STEPPE_GROUND_TOP - 1, tick % 2 === 0 ? "||" : "/\\", colors.herd, colors.ground)
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
