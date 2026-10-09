import type { FujiRun } from "./fuji-view-model"

export type SagradaStyle = "sagrada-day" | "sagrada-night"
export function isSagradaStyle(style: string | undefined): style is SagradaStyle {
  return style === "sagrada-day" || style === "sagrada-night"
}

/** Reference composition size shared by both renderers. */
export const SAGRADA_COLUMNS = 76
export const SAGRADA_ROWS = 24
/** Four spire peaks, left to right. */
export const SAGRADA_SPIRES = [24, 33, 43, 52] as const
export const SAGRADA_SPIRE_TOP = 2
/** Outer bell towers sit below the central pair in both renderers. */
export const SAGRADA_SPIRE_TOPS = [3.4, SAGRADA_SPIRE_TOP, SAGRADA_SPIRE_TOP, 3.4] as const
export const SAGRADA_SPIRE_BASE = 16
export const SAGRADA_BODY_TOP = 14
export const SAGRADA_GROUND_TOP = 19
export const SAGRADA_MOON = { x: 64, y: 2 } as const
export const SAGRADA_ROSE = { x: 38, y: 11 } as const
export const SAGRADA_CRANE_X = 64
export const SAGRADA_TREES = [10, 70] as const
export const SAGRADA_DOVE_COUNT = 4
/** Visitors admiring the facade. */
export const SAGRADA_CROWD = [20, 26, 48, 54] as const
/** Night stars in row-major order, shared by both renderers. */
export const SAGRADA_STARS = [
  { x: 3, y: 0 },
  { x: 10, y: 2 },
  { x: 17, y: 1 },
  { x: 58, y: 0 },
  { x: 70, y: 2 },
] as const

/** Palette shared by the text and pixel renderers. */
export const SAGRADA_COLORS = {
  "sagrada-day": {
    sky: "#7ab5d3",
    skyBottom: "#f2e4c8",
    stone: "#c9b184",
    stoneDark: "#7a6448",
    rib: "#a88f62",
    glass: "#4a9ac3",
    glassWarm: "#e88a4a",
    rose: "#7a2a4a",
    roseLight: "#c36a8a",
    crane: "#5a5a6a",
    tree: "#3d7a3d",
    light: "#fff3c8",
    ground: "#6a7a52",
    crowd: "#5a5a6a",
  },
  "sagrada-night": {
    sky: "#8ba0c8",
    skyBottom: "#232a55",
    stone: "#5a5248",
    stoneDark: "#332e26",
    rib: "#4a4438",
    glass: "#2a6a9a",
    glassWarm: "#c36a2a",
    rose: "#c36a8a",
    roseLight: "#e89ab8",
    crane: "#2c2c3a",
    tree: "#1e3a24",
    light: "#ffe14e",
    ground: "#1c2418",
    crowd: "#2c2c3a",
  },
} as const satisfies Record<SagradaStyle, Record<string, string>>

export function sagradaBackground(style: SagradaStyle) {
  return style === "sagrada-day" ? "#8ec8e8" : "#0e1433"
}

/** Sample the vertical sky gradient. `t` is 0 at the top of the frame. */
export function sagradaSkyRgb(style: SagradaStyle, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(sagradaBackground(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(SAGRADA_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

/** Stained-light band offset sweeping the facade on a 2400ms round. */
export function sagradaLightX(elapsedMs: number): number {
  return Math.floor((Math.max(0, elapsedMs) % 2400) / 100)
}

/** Crane-hook sway -1..1 on a 1200ms round. */
export function sagradaHook(elapsedMs: number): number {
  return Math.round(Math.sin((Math.max(0, elapsedMs) / 1200) * Math.PI * 2))
}

export type SagradaDove = { x: number; y: number }
/** Doves crossing above the spires. */
export function sagradaDoves(elapsedMs: number): SagradaDove[] {
  const step = Math.floor(Math.max(0, elapsedMs) / 280) * 2
  return Array.from({ length: SAGRADA_DOVE_COUNT }, (_, i) => ({
    x: (i * 19 + 5 + step) % (SAGRADA_COLUMNS + 8),
    y: 3 + (i % 2),
  }))
}

export function sagradaRows(columns: number, rows: number, style: SagradaStyle, elapsedMs: number): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const night = style === "sagrada-night"
  const colors = SAGRADA_COLORS[style]
  const hook = sagradaHook(elapsedMs)
  const grid: FujiRun[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: colors.sky })),
  )
  const left = Math.floor((width - SAGRADA_COLUMNS) / 2),
    top = Math.floor((height - SAGRADA_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + Math.round(y)
    if (row < 0 || row >= height) return
    for (let i = 0; i < text.length; i++) {
      const sceneX = Math.round(x) + i
      const column = left + sceneX
      if (sceneX < 0 || sceneX >= SAGRADA_COLUMNS || column < 0 || column >= width) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }
  if (night) {
    SAGRADA_STARS.forEach((star, i) => {
      paint(star.x, star.y, (Math.floor(Math.max(0, elapsedMs) / 400) + i) % 3 === 0 ? "*" : ".", colors.sky)
    })
    paint(SAGRADA_MOON.x - 1, SAGRADA_MOON.y - 1, ".-.", colors.light)
    paint(SAGRADA_MOON.x - 2, SAGRADA_MOON.y, "(   )", colors.light)
  }
  // Doves crossing above the spires.
  const flap = Math.floor(Math.max(0, elapsedMs) / 300) % 2 === 0
  for (const dove of sagradaDoves(elapsedMs)) {
    paint(dove.x, dove.y, flap ? "v" : "^", colors.crowd)
  }
  // Rose window blooming between the middle spires.
  const rose = SAGRADA_ROSE
  paint(rose.x, rose.y - 2, "o", colors.rose)
  paint(rose.x - 1, rose.y - 1, "o", colors.rose)
  paint(rose.x, rose.y - 1, "O", colors.roseLight)
  paint(rose.x + 1, rose.y - 1, "o", colors.rose)
  paint(rose.x - 2, rose.y, "o", colors.rose)
  paint(rose.x - 1, rose.y, "OOO", colors.roseLight)
  paint(rose.x + 2, rose.y, "o", colors.rose)
  paint(rose.x - 1, rose.y + 1, "o", colors.rose)
  paint(rose.x, rose.y + 1, "O", colors.roseLight)
  paint(rose.x + 1, rose.y + 1, "o", colors.rose)
  paint(rose.x, rose.y + 2, "o", colors.rose)
  // Ribbed tapering spires with glowing tips.
  for (const [index, peak] of SAGRADA_SPIRES.entries()) {
    const top = Math.round(SAGRADA_SPIRE_TOPS[index]!)
    for (let y = top; y <= SAGRADA_SPIRE_BASE; y++) {
      const half = 1 + Math.floor(((y - top) / (SAGRADA_SPIRE_BASE - top)) * 3)
      paint(peak - half, y, "|" + " ".repeat(half * 2 - 1) + "|", colors.stoneDark, colors.stone)
      paint(peak, y, ":", colors.rib, colors.stone)
    }
    paint(peak, top - 1, night ? "*" : "+", night ? colors.light : colors.glass)
  }
  // Construction crane still finishing the temple.
  const crane = SAGRADA_CRANE_X
  for (let y = 4; y <= 12; y++) {
    paint(crane, y, "|", colors.crane)
  }
  paint(58, 4, "------------", colors.crane)
  paint(57, 4, "#", colors.crane)
  const cableX = 68 + hook
  for (let y = 5; y <= 8; y++) {
    paint(cableX, y, "|", colors.crane)
  }
  paint(cableX, 9, "J", colors.crane)
  paint(cableX - 1, 10, "[]", colors.crane)
  // Cypress sentinels flanking the approach.
  for (const tree of SAGRADA_TREES) {
    paint(tree, 15, "/\\", colors.tree)
    paint(tree, 16, "||", colors.tree)
    paint(tree, 17, "||", colors.tree)
  }
  // Facade with arched windows and a sweeping light band.
  const sweep = 18 + sagradaLightX(elapsedMs)
  for (let y = SAGRADA_BODY_TOP; y < SAGRADA_GROUND_TOP; y++) {
    paint(18, y, "|" + " ".repeat(39) + "|", colors.stoneDark, colors.stone)
  }
  for (const wx of [23, 30, 37, 44, 51]) {
    paint(wx, 15, "()", night ? colors.light : colors.glass, colors.stone)
    paint(wx, 16, "[]", night ? colors.light : colors.glassWarm, colors.stone)
  }
  for (let y = SAGRADA_BODY_TOP; y < SAGRADA_GROUND_TOP; y++) {
    paint(sweep - (y - SAGRADA_BODY_TOP), y, "/", colors.light, colors.stone)
  }
  // Visitors admiring the facade.
  for (const visitor of SAGRADA_CROWD) {
    paint(visitor, 17, "o", colors.crowd)
    paint(visitor, 18, "|", colors.crowd)
  }
  for (let y = SAGRADA_GROUND_TOP; y < SAGRADA_ROWS; y++) {
    paint(0, y, " ".repeat(SAGRADA_COLUMNS), colors.ground, colors.ground)
  }
  // Stained-glass light pooling on the plaza.
  paint(28, SAGRADA_GROUND_TOP + 1, "~~~~~", colors.glass, colors.ground)
  paint(42, SAGRADA_GROUND_TOP + 1, "~~~~~", colors.glassWarm, colors.ground)
  // Flower beds along the forecourt.
  for (let x = 4; x < SAGRADA_COLUMNS; x += 8) {
    paint(x, SAGRADA_GROUND_TOP + 3, "@", colors.roseLight, colors.ground)
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
