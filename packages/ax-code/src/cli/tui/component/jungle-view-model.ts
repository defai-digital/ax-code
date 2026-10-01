import type { FujiRun } from "./fuji-view-model"

export type JungleStyle = "jungle-day" | "jungle-night"
export function isJungleStyle(style: string | undefined): style is JungleStyle {
  return style === "jungle-day" || style === "jungle-night"
}

/** Reference composition size shared by both renderers. */
export const JUNGLE_COLUMNS = 76
export const JUNGLE_ROWS = 24
export const JUNGLE_CANOPY_BOTTOM = 6
export const JUNGLE_GROUND_TOP = 20
/** Vines hanging from the canopy, swaying at the tip. */
export const JUNGLE_VINES = [10, 26, 50, 66] as const
/** Sun shafts slanting through the day canopy. */
export const JUNGLE_SHAFTS = [18, 38, 58] as const
/** Trunk columns rooting the canopy. */
export const JUNGLE_TRUNKS = [4, 36, 70] as const
export const JUNGLE_MOON = { x: 62, y: 1 } as const
export const JUNGLE_PARROT_Y = 10
export const JUNGLE_LEAF_COUNT = 10
export const JUNGLE_FIREFLY_COUNT = 8
export const JUNGLE_CYCLE_MS = 2400

/** Palette shared by the text and pixel renderers. */
export const JUNGLE_COLORS = {
  "jungle-day": {
    sky: "#9fd0e8",
    skyBottom: "#e8f2d8",
    leaf: "#2e7a34",
    leafDark: "#1e5224",
    leafLight: "#6aba5a",
    shaft: "#fff2b0",
    vine: "#3d8a3d",
    trunk: "#6a4a2c",
    parrot: "#e83a3a",
    ground: "#4a6a34",
    fern: "#5aaa4a",
    flower: "#ff7ab0",
    firefly: "#ffe98a",
  },
  "jungle-night": {
    sky: "#1c2a4a",
    skyBottom: "#0e1628",
    leaf: "#142e1e",
    leafDark: "#0c1e12",
    leafLight: "#2c5a34",
    shaft: "#8aa8d8",
    vine: "#1e4a28",
    trunk: "#3a2a1c",
    parrot: "#8a2a2a",
    ground: "#16240f",
    fern: "#2c5a2c",
    flower: "#b08ac8",
    firefly: "#d8ff7a",
  },
} as const satisfies Record<JungleStyle, Record<string, string>>

export function jungleBackground(style: JungleStyle) {
  return style === "jungle-day" ? "#a8d8ec" : "#101a30"
}

/** Sample the vertical sky gradient. `t` is 0 at the top of the frame. */
export function jungleSkyRgb(style: JungleStyle, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(jungleBackground(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(JUNGLE_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

export type JungleLeaf = { x: number; y: number }
/** Leaves falling from the canopy on the shared 2400ms cycle. */
export function jungleLeaves(elapsedMs: number): JungleLeaf[] {
  const phase = (Math.max(0, elapsedMs) % JUNGLE_CYCLE_MS) / JUNGLE_CYCLE_MS
  return Array.from({ length: JUNGLE_LEAF_COUNT }, (_, i) => {
    const y = 7 + ((((i * 13 + 2) % 12) + phase * (6 + (i % 3) * 2)) % 12)
    const sway = Math.sin(2 * Math.PI * (phase + i / JUNGLE_LEAF_COUNT)) * 2
    const drifted = ((i * 23 + 9) % JUNGLE_COLUMNS) - phase * 6 + sway
    const x = ((drifted % JUNGLE_COLUMNS) + JUNGLE_COLUMNS) % JUNGLE_COLUMNS
    return { x: Math.floor(x), y: Math.floor(y) }
  })
}

export type JungleFirefly = { x: number; y: number; char: string }
/** Fireflies drifting under the moonlit canopy, blinking on a 300ms beat. */
export function jungleFireflies(elapsedMs: number): JungleFirefly[] {
  const safe = Math.max(0, elapsedMs)
  const phase = (safe % JUNGLE_CYCLE_MS) / JUNGLE_CYCLE_MS
  return Array.from({ length: JUNGLE_FIREFLY_COUNT }, (_, i) => {
    const y = 19 - ((((i * 11 + 3) % 12) + phase * (8 + (i % 3) * 2)) % 12)
    const sway = Math.sin(2 * Math.PI * (phase + i / JUNGLE_FIREFLY_COUNT)) * 2
    const x = ((i * 29 + 7) % JUNGLE_COLUMNS) + sway
    return {
      x: Math.max(0, Math.min(JUNGLE_COLUMNS - 1, Math.floor(x))),
      y: Math.floor(y),
      char: (Math.floor(safe / 300) + i) % 2 === 0 ? "*" : ".",
    }
  })
}

/** Scene-space X of the parrot's beak, flying left to right. */
export function jungleParrotX(elapsedMs: number): number {
  const phase = (Math.max(0, elapsedMs) % JUNGLE_CYCLE_MS) / JUNGLE_CYCLE_MS
  return Math.floor(phase * (JUNGLE_COLUMNS + 8)) - 4
}

/** Vine-tip sway in cells, shared by both renderers. */
export function jungleSway(elapsedMs: number, vineX: number): number {
  const phase = (Math.max(0, elapsedMs) % JUNGLE_CYCLE_MS) / JUNGLE_CYCLE_MS
  return Math.round(Math.sin(2 * Math.PI * (phase + vineX / JUNGLE_COLUMNS)) * 2)
}

export function jungleRows(columns: number, rows: number, style: JungleStyle, elapsedMs: number): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const night = style === "jungle-night"
  const colors = JUNGLE_COLORS[style]
  const grid: FujiRun[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: colors.sky })),
  )
  const left = Math.floor((width - JUNGLE_COLUMNS) / 2),
    top = Math.floor((height - JUNGLE_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + Math.round(y)
    if (row < 0 || row >= height) return
    for (let i = 0; i < text.length; i++) {
      const sceneX = Math.round(x) + i
      const column = left + sceneX
      if (sceneX < 0 || sceneX >= JUNGLE_COLUMNS || column < 0 || column >= width) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }
  for (let y = 0; y <= JUNGLE_CANOPY_BOTTOM; y++) {
    paint(0, y, " ".repeat(JUNGLE_COLUMNS), colors.leaf, colors.leafDark)
  }
  for (let y = 1; y <= 5; y += 2) {
    for (let x = 2; x < JUNGLE_COLUMNS; x += 5) {
      paint(x + (y % 2), y, "o", colors.leafLight, colors.leafDark)
    }
  }
  if (night) {
    paint(56, 0, " ".repeat(13), colors.sky, colors.sky)
    paint(56, 1, " ".repeat(13), colors.sky, colors.sky)
    paint(56, 2, " ".repeat(13), colors.sky, colors.sky)
    paint(JUNGLE_MOON.x - 1, JUNGLE_MOON.y - 1, ".-.", colors.shaft)
    paint(JUNGLE_MOON.x - 2, JUNGLE_MOON.y, "(   )", colors.shaft)
  } else {
    for (const shaft of JUNGLE_SHAFTS) {
      for (let y = 7; y <= 16; y++) {
        paint(shaft + Math.floor((y - 7) / 3), y, "/", colors.shaft)
      }
    }
  }
  if (!night) {
    for (const leaf of jungleLeaves(elapsedMs)) {
      const row = top + leaf.y
      if (row < 0 || row >= height) continue
      const column = left + leaf.x
      if (leaf.x < 0 || leaf.x >= JUNGLE_COLUMNS || column < 0 || column >= width) continue
      const cell = grid[row]![column]!
      grid[row]![column] = { text: ".", color: colors.leafLight, background: cell.background }
    }
  }
  for (const vine of JUNGLE_VINES) {
    for (let y = 7; y <= 13; y++) {
      paint(vine, y, "|", colors.vine)
    }
    paint(vine + jungleSway(elapsedMs, vine), 14, "o", colors.vine)
  }
  for (const trunk of JUNGLE_TRUNKS) {
    for (let y = 12; y <= 19; y++) {
      paint(trunk, y, "|", colors.trunk)
    }
  }
  if (!night) {
    const parrotX = jungleParrotX(elapsedMs)
    paint(parrotX - 1, JUNGLE_PARROT_Y - 1, "^", colors.parrot)
    paint(parrotX - 1, JUNGLE_PARROT_Y, "=>", colors.parrot)
  } else {
    for (const mote of jungleFireflies(elapsedMs)) {
      const row = top + mote.y
      if (row < 0 || row >= height) continue
      const column = left + mote.x
      if (mote.x < 0 || mote.x >= JUNGLE_COLUMNS || column < 0 || column >= width) continue
      const cell = grid[row]![column]!
      grid[row]![column] = { text: mote.char, color: colors.firefly, background: cell.background }
    }
  }
  for (let y = JUNGLE_GROUND_TOP; y < JUNGLE_ROWS; y++) {
    paint(0, y, " ".repeat(JUNGLE_COLUMNS), colors.ground, colors.ground)
  }
  for (let x = 1; x < JUNGLE_COLUMNS; x += 7) {
    paint(x, JUNGLE_GROUND_TOP + 1, '"', colors.fern, colors.ground)
  }
  for (const bloom of [6, 30, 54]) {
    paint(bloom, JUNGLE_GROUND_TOP + 2, "*", colors.flower, colors.ground)
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
