import type { FujiRun } from "./fuji-view-model"

export type BrandenburgStyle = "brandenburg-night" | "brandenburg-dawn"
export function isBrandenburgStyle(style: string | undefined): style is BrandenburgStyle {
  return style === "brandenburg-night" || style === "brandenburg-dawn"
}

/** Reference composition size shared by both renderers. */
export const BRANDENBURG_COLUMNS = 76
export const BRANDENBURG_ROWS = 24
/** Six column centers, left to right. */
export const BRANDENBURG_PILLARS = [20, 27, 34, 42, 49, 56] as const
export const BRANDENBURG_SHAFT_TOP = 9
export const BRANDENBURG_SHAFT_BASE = 17
export const BRANDENBURG_LINTEL = 8
export const BRANDENBURG_GROUND_TOP = 19
export const BRANDENBURG_FLAGS = [
  { x: 14, y: 4 },
  { x: 60, y: 4 },
] as const
export const BRANDENBURG_TREES = [6, 68] as const
export const BRANDENBURG_DOVE_COUNT = 4
export const BRANDENBURG_MOON = { x: 62, y: 2 } as const
export const BRANDENBURG_SUN = { x: 12, y: 2 } as const
/** Plaza lamp posts flanking the gate. */
export const BRANDENBURG_PLAZA_LAMPS = [10, 66] as const
/** Tourists strolling before the colonnade. */
export const BRANDENBURG_TOURISTS = [24, 38, 46] as const
/** Night stars in row-major order, shared by both renderers. */
export const BRANDENBURG_STARS = [
  { x: 3, y: 0 },
  { x: 30, y: 1 },
  { x: 45, y: 0 },
  { x: 70, y: 2 },
] as const

/** Palette shared by the text and pixel renderers. */
export const BRANDENBURG_COLORS = {
  "brandenburg-night": {
    sky: "#8ba0c8",
    skyBottom: "#1c2a55",
    stone: "#4a4a5e",
    stoneDark: "#2c2c3a",
    relief: "#5a5a72",
    flag: "#c33d4e",
    flagWave: "#7a1e2e",
    lamp: "#ffd166",
    cobble: "#232838",
    tree: "#1e3a24",
    victory: "#ffd166",
    ground: "#1c2418",
    moon: "#e8e4f5",
    crowd: "#8a8aa8",
  },
  "brandenburg-dawn": {
    sky: "#9db8d8",
    skyBottom: "#f2d8b0",
    stone: "#b0a488",
    stoneDark: "#6e6450",
    relief: "#8a8068",
    flag: "#e04a5a",
    flagWave: "#a82a3a",
    lamp: "#fff3c8",
    cobble: "#6a6252",
    tree: "#2c5a34",
    victory: "#fff3c8",
    ground: "#4a5a42",
    moon: "#fff8e8",
    crowd: "#5a5a72",
  },
} as const satisfies Record<BrandenburgStyle, Record<string, string>>

export function brandenburgBackground(style: BrandenburgStyle) {
  return style === "brandenburg-night" ? "#0a1030" : "#a8c4e0"
}

/** Sample the vertical sky gradient. `t` is 0 at the top of the frame. */
export function brandenburgSkyRgb(style: BrandenburgStyle, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(brandenburgBackground(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(BRANDENBURG_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

/** Flag ripple phase 0..2 advancing every 300ms. */
export function brandenburgWave(elapsedMs: number): number {
  return Math.floor(Math.max(0, elapsedMs) / 300) % 3
}

/** Gate lamps breathe on an 800ms beat, bright at rest. */
export function brandenburgLamp(elapsedMs: number): boolean {
  return Math.floor(Math.max(0, elapsedMs) / 400) % 2 === 0
}

export type BrandenburgDove = { x: number; y: number }
/** Doves crossing over the gate. */
export function brandenburgDoves(elapsedMs: number): BrandenburgDove[] {
  const step = Math.floor(Math.max(0, elapsedMs) / 280) * 2
  return Array.from({ length: BRANDENBURG_DOVE_COUNT }, (_, i) => ({
    x: (i * 19 + 6 + step) % (BRANDENBURG_COLUMNS + 8),
    y: 2 + (i % 2),
  }))
}

export function brandenburgRows(
  columns: number,
  rows: number,
  style: BrandenburgStyle,
  elapsedMs: number,
): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const night = style === "brandenburg-night"
  const colors = BRANDENBURG_COLORS[style]
  const wave = brandenburgWave(elapsedMs)
  const lampBright = brandenburgLamp(elapsedMs)
  const grid: FujiRun[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: colors.sky })),
  )
  const left = Math.floor((width - BRANDENBURG_COLUMNS) / 2),
    top = Math.floor((height - BRANDENBURG_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + Math.round(y)
    if (row < 0 || row >= height) return
    for (let i = 0; i < text.length; i++) {
      const sceneX = Math.round(x) + i
      const column = left + sceneX
      if (sceneX < 0 || sceneX >= BRANDENBURG_COLUMNS || column < 0 || column >= width) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }
  if (night) {
    BRANDENBURG_STARS.forEach((star, i) => {
      paint(star.x, star.y, (Math.floor(Math.max(0, elapsedMs) / 400) + i) % 3 === 0 ? "*" : ".", colors.sky)
    })
  }
  // Doves crossing over the gate.
  const flap = Math.floor(Math.max(0, elapsedMs) / 300) % 2 === 0
  for (const dove of brandenburgDoves(elapsedMs)) {
    paint(dove.x, dove.y, flap ? "v" : "^", colors.crowd)
  }
  // Moonrise by night, low sun by dawn.
  const orb = night ? BRANDENBURG_MOON : BRANDENBURG_SUN
  paint(orb.x - 1, orb.y - 1, ".-.", colors.moon)
  paint(orb.x - 2, orb.y, "(   )", colors.moon)
  // Tiergarten sentinels behind the gate.
  for (const tree of BRANDENBURG_TREES) {
    paint(tree - 2, 6, "/\\/\\", colors.tree)
    paint(tree - 3, 7, "/\\/\\/\\", colors.tree)
    paint(tree - 2, 8, "\\/\\/", colors.tree)
    paint(tree, 9, "||", colors.tree)
    paint(tree, 10, "||", colors.tree)
    paint(tree, 11, "||", colors.tree)
  }
  // Waving flags on poles flanking the gate.
  for (const flag of BRANDENBURG_FLAGS) {
    paint(flag.x, flag.y, "|", colors.stoneDark)
    paint(flag.x, flag.y + 1, "|", colors.stoneDark)
    paint(flag.x, flag.y + 2, "|", colors.stoneDark)
    const ripple = wave === 0 ? ">>>" : wave === 1 ? "~~~" : "<<<"
    paint(flag.x + 1, flag.y, ripple, colors.flag)
    paint(flag.x + 1, flag.y + 1, ripple, colors.flagWave)
  }
  // Quadriga with Victory crowning the gate.
  paint(37, 4, "^", colors.victory)
  paint(36, 5, "/M\\", colors.stoneDark, colors.stone)
  paint(35, 6, "|___|", colors.stoneDark, colors.stone)
  paint(17, 7, "=".repeat(42), colors.stoneDark)
  paint(17, BRANDENBURG_LINTEL, "#".repeat(42), colors.stone, colors.stoneDark)
  for (let x = 19; x <= 55; x += 6) {
    paint(x, BRANDENBURG_LINTEL, "o", colors.relief, colors.stoneDark)
  }
  for (const pillar of BRANDENBURG_PILLARS) {
    for (let y = BRANDENBURG_SHAFT_TOP; y <= BRANDENBURG_SHAFT_BASE; y++) {
      paint(pillar - 1, y, "|||", colors.stoneDark, colors.stone)
    }
    paint(pillar - 2, BRANDENBURG_SHAFT_BASE + 1, "=====", colors.stoneDark)
  }
  // Gate lamps breathe through the night and fade by dawn.
  for (const lx of [24, 52]) {
    paint(lx, 12, night ? (lampBright ? "*" : ".") : ".", colors.lamp)
  }
  // Plaza lamp posts flanking the gate.
  for (const post of BRANDENBURG_PLAZA_LAMPS) {
    paint(post, 16, "*", colors.lamp)
    paint(post, 17, "|", colors.stoneDark)
    paint(post, 18, "|", colors.stoneDark)
  }
  // Tourists strolling before the colonnade.
  for (const visitor of BRANDENBURG_TOURISTS) {
    paint(visitor, 17, "o", colors.crowd)
    paint(visitor, 18, "|", colors.crowd)
  }
  for (let y = BRANDENBURG_GROUND_TOP; y < BRANDENBURG_ROWS; y++) {
    paint(0, y, " ".repeat(BRANDENBURG_COLUMNS), colors.ground, colors.ground)
  }
  // Cobbled plaza before the gate.
  for (let x = 0; x < BRANDENBURG_COLUMNS; x += 3) {
    paint(x, BRANDENBURG_GROUND_TOP, ".", colors.cobble, colors.ground)
  }
  // Flower beds edging the plaza.
  for (let x = 4; x < BRANDENBURG_COLUMNS; x += 8) {
    paint(x, BRANDENBURG_GROUND_TOP + 2, "@", colors.flag, colors.ground)
    paint(x, BRANDENBURG_GROUND_TOP + 3, "|", colors.tree, colors.ground)
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
