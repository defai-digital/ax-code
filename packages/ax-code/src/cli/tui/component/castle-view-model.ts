import type { FujiRun } from "./fuji-view-model"

export type CastleStyle = "castle-day" | "castle-night"
export function isCastleStyle(style: string | undefined): style is CastleStyle {
  return style === "castle-day" || style === "castle-night"
}

/** Reference composition size shared by both renderers. */
export const CASTLE_COLUMNS = 76
export const CASTLE_ROWS = 24
export const CASTLE_KEEP = { x0: 31, x1: 44, top: 11, base: 17 } as const
export const CASTLE_TOWERS = [26, 46] as const
export const CASTLE_TOWER_TOP = 8
export const CASTLE_TOWER_BASE = 17
export const CASTLE_GATE = { x: 36, y: 15 } as const
export const CASTLE_WINDOWS = [
  { x: 34, y: 13 },
  { x: 40, y: 13 },
] as const
export const CASTLE_POLE_X = 37
export const CASTLE_POLE_TOP = 6
export const CASTLE_BANNER = { x: 38, y: 6 } as const
export const CASTLE_BEACON = { x: 27, y: 6 } as const
export const CASTLE_SUN = { x: 12, y: 2 } as const
export const CASTLE_MOON = { x: 62, y: 2 } as const
export const CASTLE_CLOUDS = [
  { x: 8, y: 3 },
  { x: 55, y: 4 },
  { x: 30, y: 6 },
] as const
export const CASTLE_BIRDS = [18, 30, 52] as const
export const CASTLE_BIRD_ROW = 5
export const CASTLE_TREES = [6, 66] as const
export const CASTLE_SLOPE_ROW = 19
export const CASTLE_HILL_TOP = 20
/** Night stars in row-major order, shared by both renderers. */
export const CASTLE_STARS = [
  { x: 4, y: 0 },
  { x: 15, y: 1 },
  { x: 24, y: 0 },
  { x: 45, y: 1 },
  { x: 55, y: 0 },
  { x: 70, y: 3 },
  { x: 68, y: 1 },
] as const
export const CASTLE_CYCLE_MS = 2400

/** Palette shared by the text and pixel renderers. */
export const CASTLE_COLORS = {
  "castle-day": {
    sky: "#7ab5d3",
    skyBottom: "#e4f2da",
    sun: "#ffd166",
    moon: "#d8dee8",
    star: "#ffffff",
    cloud: "#f2f8fc",
    bird: "#2c2c3a",
    wall: "#b8b0a0",
    wallDark: "#7a7468",
    roof: "#8a3a2a",
    banner: "#c33d1e",
    gate: "#4a3428",
    window: "#3a4a5e",
    lit: "#ffd166",
    beacon: "#ff5252",
    hill: "#5a7a4a",
    hillDark: "#3a5a30",
    tree: "#3d7a3d",
    path: "#c8c0b0",
    wood: "#6e4a2a",
  },
  "castle-night": {
    sky: "#8ba0c8",
    skyBottom: "#1c2a55",
    sun: "#e8c86a",
    moon: "#e8ecf8",
    star: "#c8d4f0",
    cloud: "#2c3a5e",
    bird: "#2c2c44",
    wall: "#6e6a7e",
    wallDark: "#4a4658",
    roof: "#5a2a20",
    banner: "#8a2a18",
    gate: "#241a14",
    window: "#2a3a4e",
    lit: "#ffca5a",
    beacon: "#ff5252",
    hill: "#1a2a1a",
    hillDark: "#101a10",
    tree: "#1e3a24",
    path: "#4a463e",
    wood: "#4a3420",
  },
} as const satisfies Record<CastleStyle, Record<string, string>>

export function castleBackground(style: CastleStyle) {
  return style === "castle-day" ? "#8ec8e8" : "#0a1030"
}

/** Sample the vertical sky gradient. `t` is 0 at the top of the frame. */
export function castleSkyRgb(style: CastleStyle, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(castleBackground(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(CASTLE_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

/** Loop phase in [0, 1). All motion derives from it so frames loop bit-identically. */
export function castlePhase(elapsedMs: number): number {
  return (Math.max(0, elapsedMs) % CASTLE_CYCLE_MS) / CASTLE_CYCLE_MS
}

/** Banners stream on a 600ms beat, flying right at rest. */
export function castleWave(elapsedMs: number): boolean {
  return Math.floor(Math.max(0, elapsedMs) / 600) % 2 === 0
}

/** The rooftop beacon blinks on a 400ms beat, bright at rest. */
export function castleBeaconBright(elapsedMs: number): boolean {
  return Math.floor(Math.max(0, elapsedMs) / 400) % 2 === 0
}

/** Stars take turns shining on a 400ms beat. */
export function castleTwinkle(elapsedMs: number, index: number): boolean {
  return (Math.floor(Math.max(0, elapsedMs) / 400) + index) % 3 === 0
}

/** Cloud drift in cells, subtracted from each base X with wraparound. */
export function castleCloudShift(elapsedMs: number): number {
  return Math.floor(castlePhase(elapsedMs) * 16)
}

/** Bird travel in cells, added to each base X with wraparound. */
export function castleBirdShift(elapsedMs: number): number {
  return Math.floor(castlePhase(elapsedMs) * 24)
}

export function castleRows(columns: number, rows: number, style: CastleStyle, elapsedMs: number): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const day = style === "castle-day"
  const colors = CASTLE_COLORS[style]
  const grid: FujiRun[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: colors.sky })),
  )
  const left = Math.floor((width - CASTLE_COLUMNS) / 2),
    top = Math.floor((height - CASTLE_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + Math.round(y)
    if (row < 0 || row >= height) return
    for (let i = 0; i < text.length; i++) {
      const sceneX = Math.round(x) + i
      const column = left + sceneX
      if (sceneX < 0 || sceneX >= CASTLE_COLUMNS || column < 0 || column >= width) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }
  if (day) {
    paint(CASTLE_SUN.x - 1, CASTLE_SUN.y - 1, ".-.", colors.sun)
    paint(CASTLE_SUN.x - 2, CASTLE_SUN.y, "(   )", colors.sun)
    const shift = castleBirdShift(elapsedMs)
    for (const base of CASTLE_BIRDS) {
      paint((base + shift) % CASTLE_COLUMNS, CASTLE_BIRD_ROW, "v", colors.bird)
    }
  } else {
    CASTLE_STARS.forEach((star, i) => {
      paint(star.x, star.y, castleTwinkle(elapsedMs, i) ? "*" : ".", colors.star)
    })
    paint(CASTLE_MOON.x - 1, CASTLE_MOON.y - 1, ".-.", colors.moon)
    paint(CASTLE_MOON.x - 2, CASTLE_MOON.y, "(   )", colors.moon)
  }
  const drift = castleCloudShift(elapsedMs)
  for (const cloud of CASTLE_CLOUDS) {
    const nx = (((cloud.x - drift) % CASTLE_COLUMNS) + CASTLE_COLUMNS) % CASTLE_COLUMNS
    paint(nx, cloud.y, "(~~)", colors.cloud)
  }
  // Twin towers with pointed roofs flank the keep.
  for (const tower of CASTLE_TOWERS) {
    paint(tower, CASTLE_TOWER_TOP - 1, "/--\\", colors.roof)
    for (let y = CASTLE_TOWER_TOP; y <= CASTLE_TOWER_BASE; y++) {
      paint(tower, y, "|  |", colors.wallDark, colors.wall)
    }
  }
  if (!day) {
    paint(CASTLE_BEACON.x, CASTLE_BEACON.y, castleBeaconBright(elapsedMs) ? "*" : ".", colors.beacon)
  }
  const keep = CASTLE_KEEP
  paint(keep.x0, keep.top - 1, "#_".repeat((keep.x1 - keep.x0 + 1) / 2), colors.wallDark, colors.wall)
  for (let y = keep.top; y <= keep.base; y++) {
    paint(keep.x0, y, "|" + " ".repeat(keep.x1 - keep.x0 - 1) + "|", colors.wallDark, colors.wall)
  }
  for (const win of CASTLE_WINDOWS) {
    paint(win.x, win.y, day ? "[ ]" : "[*]", day ? colors.window : colors.lit, colors.wall)
  }
  paint(CASTLE_GATE.x, CASTLE_GATE.y, ".--.", colors.gate, colors.wall)
  paint(CASTLE_GATE.x, CASTLE_GATE.y + 1, "|  |", colors.gate, colors.wall)
  paint(CASTLE_GATE.x, CASTLE_GATE.y + 2, "|  |", colors.gate, colors.wall)
  // Banner pole rises from the battlements; the banner streams with the wind.
  for (let y = CASTLE_POLE_TOP; y < keep.top - 1; y++) {
    paint(CASTLE_POLE_X, y, "|", colors.wood)
  }
  paint(CASTLE_BANNER.x, CASTLE_BANNER.y, castleWave(elapsedMs) ? "=>>" : "<<=", colors.banner)
  // Foundation, hill slope, and the path to the gate.
  paint(CASTLE_TOWERS[0]!, CASTLE_TOWER_BASE + 1, " ".repeat(24), colors.wallDark, colors.wallDark)
  for (const tree of CASTLE_TREES) {
    paint(tree, CASTLE_TOWER_BASE + 1, "/\\", colors.tree)
  }
  paint(0, CASTLE_SLOPE_ROW, " ".repeat(CASTLE_COLUMNS), colors.hillDark, colors.hillDark)
  for (const tree of CASTLE_TREES) {
    paint(tree, CASTLE_SLOPE_ROW, "||", colors.tree, colors.hillDark)
  }
  for (let y = CASTLE_HILL_TOP; y < CASTLE_ROWS; y++) {
    paint(0, y, " ".repeat(CASTLE_COLUMNS), colors.hill, colors.hill)
  }
  paint(CASTLE_GATE.x, CASTLE_HILL_TOP + 1, "===", colors.path, colors.hill)
  paint(CASTLE_GATE.x - 1, CASTLE_HILL_TOP + 2, "=====", colors.path, colors.hill)
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
