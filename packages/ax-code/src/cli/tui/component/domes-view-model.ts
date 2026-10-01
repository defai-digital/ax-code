import type { FujiRun } from "./fuji-view-model"

export type DomesStyle = "domes-snow" | "domes-clear"
export function isDomesStyle(style: string | undefined): style is DomesStyle {
  return style === "domes-snow" || style === "domes-clear"
}

/** Reference composition size shared by both renderers. */
export const DOMES_COLUMNS = 76
export const DOMES_ROWS = 24
/** Three dome centers with radii, left to right. */
export const DOMES_DOME = [
  { x: 22, r: 4 },
  { x: 38, r: 6 },
  { x: 54, r: 4 },
] as const
export const DOMES_BASE_TOP = 12
export const DOMES_BASE_BOTTOM = 17
export const DOMES_GROUND_TOP = 19
export const DOMES_FLAKE_COUNT = 24
export const DOMES_BIG_FLAKE_COUNT = 8
/** Flanking evergreen trunks. */
export const DOMES_PINES = [5, 70] as const
/** Bell arch standing left of the wall. */
export const DOMES_BELL = { x: 8, top: 13, base: 16 } as const
export const DOMES_CHIMNEY_X = 60

/** Palette shared by the text and pixel renderers. */
export const DOMES_COLORS = {
  "domes-snow": {
    sky: "#a8b8d8",
    skyBottom: "#d8e2f0",
    dome: "#2a6a9a",
    domeShade: "#1a3a5c",
    cross: "#d8b84a",
    drum: "#8a94a8",
    wall: "#d8dce2",
    wallDark: "#9aa2ae",
    door: "#4a3a30",
    pines: "#2a5a3a",
    flake: "#ffffff",
    ground: "#c8d4e4",
    smoke: "#d8dce2",
    wood: "#6a4a32",
    glow: "#ffd166",
  },
  "domes-clear": {
    sky: "#6aaed6",
    skyBottom: "#cfe8f5",
    dome: "#3d8ac3",
    domeShade: "#245a8a",
    cross: "#e8c84a",
    drum: "#7a8498",
    wall: "#eef1f5",
    wallDark: "#aab2be",
    door: "#5a4636",
    pines: "#2c6a44",
    flake: "#ffffff",
    ground: "#8aa48a",
    smoke: "#ffffff",
    wood: "#7a5236",
    glow: "#aab2be",
  },
} as const satisfies Record<DomesStyle, Record<string, string>>

export function domesBackground(style: DomesStyle) {
  return style === "domes-snow" ? "#b8c4dc" : "#7ec0e4"
}

/** Sample the vertical sky gradient. `t` is 0 at the top of the frame. */
export function domesSkyRgb(style: DomesStyle, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(domesBackground(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(DOMES_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

export type DomesFlake = { x: number; y: number }
/** Deterministic snowfall over the whole scene. */
export function domesFlakes(elapsedMs: number): DomesFlake[] {
  const t = Math.max(0, elapsedMs)
  return Array.from({ length: DOMES_FLAKE_COUNT }, (_, i) => {
    const y = (((i * 7 + 3) % DOMES_BASE_TOP) + Math.floor(t / 240) * (1 + (i % 2))) % DOMES_GROUND_TOP
    const sway = Math.round(Math.sin((t / 1200) * Math.PI * 2 + i) * 1.5)
    return { x: (i * 29 + 5 + sway + DOMES_COLUMNS) % DOMES_COLUMNS, y }
  })
}

/** Golden crosses take turns catching the light, one beat apart. */
export function domesGlint(elapsedMs: number, index: number): boolean {
  return (Math.floor(Math.max(0, elapsedMs) / 300) + index) % 5 === 0
}

export type DomesBigFlake = { x: number; y: number }
/** Large slow flakes drifting in front, snow style only. */
export function domesFlakesBig(elapsedMs: number): DomesBigFlake[] {
  const step = Math.floor(Math.max(0, elapsedMs) / 500)
  return Array.from({ length: DOMES_BIG_FLAKE_COUNT }, (_, i) => ({
    x: (i * 37 + 9 + step) % DOMES_COLUMNS,
    y: (step + i * 5) % DOMES_GROUND_TOP,
  }))
}

export function domesRows(columns: number, rows: number, style: DomesStyle, elapsedMs: number): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const snow = style === "domes-snow"
  const colors = DOMES_COLORS[style]
  const grid: FujiRun[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: colors.sky })),
  )
  const left = Math.floor((width - DOMES_COLUMNS) / 2),
    top = Math.floor((height - DOMES_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + Math.round(y)
    if (row < 0 || row >= height) return
    for (let i = 0; i < text.length; i++) {
      const sceneX = Math.round(x) + i
      const column = left + sceneX
      if (sceneX < 0 || sceneX >= DOMES_COLUMNS || column < 0 || column >= width) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }
  // Onion domes bulging over white walls.
  DOMES_DOME.forEach((dome, domeIndex) => {
    for (let y = DOMES_BASE_TOP - dome.r - 1; y < DOMES_BASE_TOP; y++) {
      const depth = y - (DOMES_BASE_TOP - dome.r - 1)
      const half = Math.round(Math.sin((depth / (dome.r + 1)) * Math.PI) * dome.r * 0.8)
      paint(dome.x - half, y, "(" + " ".repeat(Math.max(0, half * 2 - 1)) + ")", colors.domeShade, colors.dome)
    }
    paint(dome.x, DOMES_BASE_TOP - dome.r - 3, "+", colors.cross)
    paint(dome.x, DOMES_BASE_TOP - dome.r - 2, "|", colors.cross)
    if (snow && domesGlint(elapsedMs, domeIndex)) {
      paint(dome.x - 1, DOMES_BASE_TOP - dome.r - 3, "*", colors.cross)
    }
  })
  // Drum bands carry the bulbs.
  for (const dome of DOMES_DOME) {
    paint(dome.x - 2, DOMES_BASE_TOP - 1, "=====", colors.drum, colors.drum)
  }
  for (let y = DOMES_BASE_TOP; y <= DOMES_BASE_BOTTOM; y++) {
    paint(12, y, "|" + " ".repeat(51) + "|", colors.wallDark, colors.wall)
  }
  const windowGlow = snow ? colors.glow : colors.wallDark
  for (const wx of [20, 30, 40, 50]) {
    paint(wx, 14, "()", windowGlow, colors.wall)
    paint(wx, 15, "[]", windowGlow, colors.wall)
  }
  // Arched wooden door at the center.
  paint(37, 16, "||", colors.door, colors.wall)
  paint(37, 17, "||", colors.door, colors.wall)
  // Evergreens flank the church.
  for (const pine of DOMES_PINES) {
    paint(pine - 1, 15, "/\\", colors.pines)
    paint(pine - 2, 16, "/\\/\\", colors.pines)
    paint(pine, 17, "|", colors.pines)
  }
  // Bell arch left of the wall with its hanging bell.
  const bell = DOMES_BELL
  paint(bell.x, bell.top, "/--\\", colors.wallDark)
  for (let y = bell.top + 1; y <= bell.base; y++) {
    paint(bell.x, y, "|  |", colors.wallDark)
  }
  paint(bell.x + 1, bell.top + 1, "o", colors.cross)
  // Chimney breathing over the roof with a woodpile below.
  paint(DOMES_CHIMNEY_X, 10, "||", colors.wallDark)
  paint(DOMES_CHIMNEY_X, 11, "||", colors.wallDark)
  paint(60, 9, "o", colors.smoke)
  paint(61, 8, "o", colors.smoke)
  paint(62, 7, "o", colors.smoke)
  paint(8, 17, "[=]", colors.wood)
  // Picket fence before the snowfield.
  for (let x = 2; x < DOMES_COLUMNS - 2; x += 3) {
    paint(x, DOMES_GROUND_TOP - 1, "|", colors.wallDark)
  }
  if (snow) {
    for (const flake of domesFlakes(elapsedMs)) {
      const row = top + flake.y
      if (row < 0 || row >= height) continue
      const column = left + flake.x
      if (flake.x < 0 || flake.x >= DOMES_COLUMNS || column < 0 || column >= width) continue
      const cell = grid[row]![column]!
      grid[row]![column] = { text: "*", color: colors.flake, background: cell.background }
    }
    for (const big of domesFlakesBig(elapsedMs)) {
      const row = top + big.y
      if (row < 0 || row >= height) continue
      const column = left + big.x
      if (big.x < 0 || big.x >= DOMES_COLUMNS || column < 0 || column >= width) continue
      const cell = grid[row]![column]!
      grid[row]![column] = { text: "o", color: colors.flake, background: cell.background }
    }
  }
  for (let y = DOMES_GROUND_TOP; y < DOMES_ROWS; y++) {
    paint(0, y, " ".repeat(DOMES_COLUMNS), colors.ground, colors.ground)
  }
  // Footprints wandering from the door.
  paint(37, DOMES_GROUND_TOP, ".", colors.wallDark, colors.ground)
  paint(38, DOMES_GROUND_TOP + 1, ".", colors.wallDark, colors.ground)
  paint(37, DOMES_GROUND_TOP + 2, ".", colors.wallDark, colors.ground)
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
