import type { FujiRun } from "./fuji-view-model"

export type SpaceStyle = "space-launch" | "space-drift"
export function isSpaceStyle(style: string | undefined): style is SpaceStyle {
  return style === "space-launch" || style === "space-drift"
}

/** Reference composition size shared by both renderers. */
export const SPACE_COLUMNS = 76
export const SPACE_ROWS = 24
export const SPACE_ROCKET_X = 37
export const SPACE_ROCKET_TOP = 2
export const SPACE_ROCKET_BASE = 15
export const SPACE_SATELLITE_ROW = 3
export const SPACE_NEBULAE = [
  { x: 10, y: 10 },
  { x: 35, y: 11 },
  { x: 58, y: 12 },
] as const
export const SPACE_HORIZON_ROW = 19
export const SPACE_PLANET_TOP = 20
export const SPACE_CRATERS = [
  { x: 12, y: 21 },
  { x: 30, y: 22 },
  { x: 52, y: 21 },
] as const
/** Twinkling stars in row-major order, shared by both renderers. */
export const SPACE_STARS = [
  { x: 4, y: 1 },
  { x: 14, y: 0 },
  { x: 20, y: 3 },
  { x: 28, y: 1 },
  { x: 33, y: 6 },
  { x: 44, y: 2 },
  { x: 50, y: 5 },
  { x: 57, y: 1 },
  { x: 63, y: 4 },
  { x: 70, y: 2 },
  { x: 72, y: 6 },
  { x: 8, y: 6 },
] as const
export const SPACE_CYCLE_MS = 2400

/** Palette shared by the text and pixel renderers. */
export const SPACE_COLORS = {
  "space-launch": {
    sky: "#8a94c8",
    skyBottom: "#e8823c",
    star: "#e8ecf8",
    horizon: "#e8823c",
    planet: "#3d5a8a",
    crater: "#2a3f66",
    hull: "#d8dee8",
    hullDark: "#8a94a8",
    porthole: "#7ab5d3",
    flame: "#ffb14e",
    nebula: "#6a4a8a",
    satellite: "#d8b84a",
  },
  "space-drift": {
    sky: "#8a94c8",
    skyBottom: "#1c2a55",
    star: "#c8d4f0",
    horizon: "#1c2a55",
    planet: "#2a3a5e",
    crater: "#1c2844",
    hull: "#a8b0c0",
    hullDark: "#5a6274",
    porthole: "#4a7a94",
    flame: "#ff9a3c",
    nebula: "#6a4a8a",
    satellite: "#d8b84a",
  },
} as const satisfies Record<SpaceStyle, Record<string, string>>

export function spaceBackground(style: SpaceStyle) {
  return style === "space-launch" ? "#101a3a" : "#04060f"
}

/** Sample the vertical sky gradient. `t` is 0 at the top of the frame. */
export function spaceSkyRgb(style: SpaceStyle, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(spaceBackground(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(SPACE_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

/** Loop phase in [0, 1). All motion derives from it so frames loop bit-identically. */
export function spacePhase(elapsedMs: number): number {
  return (Math.max(0, elapsedMs) % SPACE_CYCLE_MS) / SPACE_CYCLE_MS
}

/** Stars take turns shining on a 400ms beat. */
export function spaceTwinkle(elapsedMs: number, index: number): boolean {
  return (Math.floor(Math.max(0, elapsedMs) / 400) + index) % 3 === 0
}

/** Rocket exhaust flickers on a 200ms beat, bright at rest. */
export function spaceFlicker(elapsedMs: number): boolean {
  return Math.floor(Math.max(0, elapsedMs) / 200) % 2 === 0
}

/** Scene-space Y of the rocket nose, ascending from base to top each loop. */
export function spaceRocketY(elapsedMs: number): number {
  const travel = SPACE_ROCKET_BASE - SPACE_ROCKET_TOP
  return SPACE_ROCKET_BASE - Math.floor(spacePhase(elapsedMs) * (travel + 1))
}

/** Scene-space X of the satellite nose, crossing left to right each loop. */
export function spaceSatelliteX(elapsedMs: number): number {
  return Math.floor(spacePhase(elapsedMs) * SPACE_COLUMNS) % SPACE_COLUMNS
}

/** Nebula drift in cells, subtracted from each base X with wraparound. */
export function spaceNebulaShift(elapsedMs: number): number {
  return Math.floor(spacePhase(elapsedMs) * 12)
}

export function spaceRows(columns: number, rows: number, style: SpaceStyle, elapsedMs: number): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const launch = style === "space-launch"
  const colors = SPACE_COLORS[style]
  const grid: FujiRun[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: colors.sky })),
  )
  const left = Math.floor((width - SPACE_COLUMNS) / 2),
    top = Math.floor((height - SPACE_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + Math.round(y)
    if (row < 0 || row >= height) return
    for (let i = 0; i < text.length; i++) {
      const sceneX = Math.round(x) + i
      const column = left + sceneX
      if (sceneX < 0 || sceneX >= SPACE_COLUMNS || column < 0 || column >= width) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }
  SPACE_STARS.forEach((star, i) => {
    paint(star.x, star.y, spaceTwinkle(elapsedMs, i) ? "*" : ".", colors.star)
  })
  if (launch) {
    const ry = spaceRocketY(elapsedMs)
    const bright = spaceFlicker(elapsedMs)
    paint(SPACE_ROCKET_X - 1, ry, " /\\ ", colors.hull)
    paint(SPACE_ROCKET_X - 1, ry + 1, "|o|", colors.hullDark, colors.hull)
    paint(SPACE_ROCKET_X, ry + 1, "o", colors.porthole, colors.hull)
    paint(SPACE_ROCKET_X - 1, ry + 2, "|_|", colors.hullDark, colors.hull)
    paint(SPACE_ROCKET_X, ry + 3, bright ? "*" : "+", bright ? colors.flame : colors.hullDark)
  } else {
    const shift = spaceNebulaShift(elapsedMs)
    for (const cloud of SPACE_NEBULAE) {
      const nx = (((cloud.x - shift) % SPACE_COLUMNS) + SPACE_COLUMNS) % SPACE_COLUMNS
      paint(nx, cloud.y, "~~~~~", colors.nebula)
    }
    paint(spaceSatelliteX(elapsedMs), SPACE_SATELLITE_ROW, "-O-", colors.satellite)
  }
  // Dawn horizon over the planet limb shared by both scenes.
  paint(0, SPACE_HORIZON_ROW, " ".repeat(SPACE_COLUMNS), colors.horizon, colors.horizon)
  for (let y = SPACE_PLANET_TOP; y < SPACE_ROWS; y++) {
    paint(0, y, " ".repeat(SPACE_COLUMNS), colors.planet, colors.planet)
  }
  for (const crater of SPACE_CRATERS) {
    paint(crater.x, crater.y, "o", colors.crater, colors.planet)
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
