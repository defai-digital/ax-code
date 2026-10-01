import type { FujiRun } from "./fuji-view-model"

export type PyramidsStyle = "pyramids-day" | "pyramids-night"
export function isPyramidsStyle(style: string | undefined): style is PyramidsStyle {
  return style === "pyramids-day" || style === "pyramids-night"
}

/** Reference composition size shared by both renderers. */
export const PYRAMIDS_COLUMNS = 76
export const PYRAMIDS_ROWS = 24
export const PYRAMIDS_SUN = { x: 60, y: 2 } as const
export const PYRAMIDS_MOON = { x: 12, y: 2 } as const
export const PYRAMIDS_APEX = { x: 30, y: 6 } as const
export const PYRAMIDS_APEX_SMALL = { x: 52, y: 9 } as const
export const PYRAMIDS_BASE_ROW = 15
export const PYRAMIDS_CARAVAN_ROW = 14
export const PYRAMIDS_CAMEL_GAP = 9
export const PYRAMIDS_CAMEL_COUNT = 3
export const PYRAMIDS_DUNE_TOP = 16
export const PYRAMIDS_FIRE = { x: 20, y: 14 } as const
/** Night stars in row-major order, shared by both renderers. */
export const PYRAMIDS_STARS = [
  { x: 4, y: 0 },
  { x: 18, y: 1 },
  { x: 33, y: 0 },
  { x: 47, y: 2 },
  { x: 63, y: 1 },
  { x: 71, y: 3 },
] as const
export const PYRAMIDS_CYCLE_MS = 2400

/** Palette shared by the text and pixel renderers. */
export const PYRAMIDS_COLORS = {
  "pyramids-day": {
    sky: "#7ab5d3",
    skyBottom: "#f2e4c0",
    sun: "#ffdf6b",
    sand: "#d8b878",
    sandDark: "#a88450",
    stone: "#c8a878",
    stoneDark: "#8a6c48",
    dune: "#e0c088",
    caravan: "#5a4028",
    palm: "#3d7a3d",
    trunk: "#6a4a28",
  },
  "pyramids-night": {
    sky: "#8ba0c8",
    skyBottom: "#1c2a55",
    sun: "#e8e8f2",
    sand: "#4a4468",
    sandDark: "#2c2844",
    stone: "#5a5478",
    stoneDark: "#34304e",
    dune: "#3a3658",
    caravan: "#8a8478",
    palm: "#1e3a24",
    trunk: "#2c2418",
  },
} as const satisfies Record<PyramidsStyle, Record<string, string>>

export function pyramidsBackground(style: PyramidsStyle) {
  return style === "pyramids-day" ? "#8ec8e8" : "#0a1030"
}

/** Sample the vertical sky gradient. `t` is 0 at the top of the frame. */
export function pyramidsSkyRgb(style: PyramidsStyle, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(pyramidsBackground(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(PYRAMIDS_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

/** Campfire flames flicker on a 400ms beat, bright at rest. */
export function pyramidsFlicker(elapsedMs: number): boolean {
  return Math.floor(Math.max(0, elapsedMs) / 200) % 2 === 0
}

/** Scene-space X of the lead camel. The caravan crosses left to right each cycle. */
export function pyramidsCaravanX(elapsedMs: number): number {
  const phase = (Math.max(0, elapsedMs) % PYRAMIDS_CYCLE_MS) / PYRAMIDS_CYCLE_MS
  return Math.floor(phase * (PYRAMIDS_COLUMNS + 24)) - 12
}

export function pyramidsRows(columns: number, rows: number, style: PyramidsStyle, elapsedMs: number): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const night = style === "pyramids-night"
  const colors = PYRAMIDS_COLORS[style]
  const flame = pyramidsFlicker(elapsedMs)
  const grid: FujiRun[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: colors.sky })),
  )
  const left = Math.floor((width - PYRAMIDS_COLUMNS) / 2),
    top = Math.floor((height - PYRAMIDS_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + Math.round(y)
    if (row < 0 || row >= height) return
    for (let i = 0; i < text.length; i++) {
      const sceneX = Math.round(x) + i
      const column = left + sceneX
      if (sceneX < 0 || sceneX >= PYRAMIDS_COLUMNS || column < 0 || column >= width) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }
  if (night) {
    PYRAMIDS_STARS.forEach((star, i) => {
      paint(star.x, star.y, (Math.floor(Math.max(0, elapsedMs) / 400) + i) % 3 === 0 ? "*" : ".", colors.sky)
    })
    paint(PYRAMIDS_MOON.x - 1, PYRAMIDS_MOON.y - 1, ".-.", colors.sun)
    paint(PYRAMIDS_MOON.x - 2, PYRAMIDS_MOON.y, "(   )", colors.sun)
  } else {
    paint(PYRAMIDS_SUN.x - 2, PYRAMIDS_SUN.y - 1, "\\ | /", colors.sun)
    paint(PYRAMIDS_SUN.x - 2, PYRAMIDS_SUN.y, "--o--", colors.sun)
    paint(PYRAMIDS_SUN.x - 2, PYRAMIDS_SUN.y + 1, "/ | \\", colors.sun)
  }
  // Great pyramid with a shaded east face, then the smaller satellite.
  const apex = PYRAMIDS_APEX
  for (let y = apex.y; y <= PYRAMIDS_BASE_ROW; y++) {
    const half = y - apex.y
    paint(apex.x - half, y, "/", colors.stoneDark)
    if (half > 0) paint(apex.x - half + 1, y, " ".repeat(half * 2 - 1), colors.stone, colors.stone)
    paint(apex.x + half, y, "\\", colors.stoneDark)
    if (half > 1) paint(apex.x + 1, y, " ".repeat(half - 1), colors.stoneDark, colors.stoneDark)
  }
  const small = PYRAMIDS_APEX_SMALL
  for (let y = small.y; y <= PYRAMIDS_BASE_ROW; y++) {
    const half = y - small.y
    paint(small.x - half, y, "/", colors.stoneDark)
    if (half > 0) paint(small.x - half + 1, y, " ".repeat(half * 2 - 1), colors.stone, colors.stone)
    paint(small.x + half, y, "\\", colors.stoneDark)
  }
  // Sandstone sphinx head watching from the west approach.
  paint(8, 12, " ___ ", colors.stoneDark)
  paint(8, 13, "|o o|", colors.stoneDark)
  paint(8, 14, "|___|", colors.stoneDark)
  // Slow caravan crossing the hardpan in front of the pyramids.
  const lead = pyramidsCaravanX(elapsedMs)
  for (let i = 0; i < PYRAMIDS_CAMEL_COUNT; i++) {
    const cx = lead - i * PYRAMIDS_CAMEL_GAP
    const bob = Math.floor((Math.max(0, elapsedMs) + i * 300) / 600) % 2
    paint(cx, PYRAMIDS_CARAVAN_ROW - bob, "o/\\", colors.caravan)
    paint(cx, PYRAMIDS_CARAVAN_ROW + 1 - bob, "|", colors.caravan)
  }
  // Night campfire with flickering flame and stacked logs.
  if (night) {
    paint(PYRAMIDS_FIRE.x - 1, PYRAMIDS_FIRE.y + 1, "=====", colors.trunk)
    paint(PYRAMIDS_FIRE.x, PYRAMIDS_FIRE.y, flame ? "(*)" : "( )", flame ? colors.sun : colors.sandDark)
    paint(PYRAMIDS_FIRE.x + 1, PYRAMIDS_FIRE.y - 1, flame ? "*" : ".", colors.sun)
  }
  // Oasis palms at the east edge.
  for (const palm of [66, 70]) {
    paint(palm, 12, "Y", colors.palm)
    paint(palm, 13, "|", colors.trunk)
    paint(palm, 14, "|", colors.trunk)
  }
  paint(65, 12, "/", colors.palm)
  paint(71, 12, "\\", colors.palm)
  for (let y = PYRAMIDS_DUNE_TOP; y < PYRAMIDS_ROWS; y++) {
    paint(0, y, " ".repeat(PYRAMIDS_COLUMNS), colors.dune, colors.dune)
  }
  // Wind-combed dune ridges.
  for (let x = 2; x < PYRAMIDS_COLUMNS; x += 11) {
    paint(x, PYRAMIDS_DUNE_TOP + 1, "~~~~", colors.sand, colors.dune)
  }
  for (let x = 7; x < PYRAMIDS_COLUMNS; x += 13) {
    paint(x, PYRAMIDS_DUNE_TOP + 4, "~~~~~", colors.sandDark, colors.dune)
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
