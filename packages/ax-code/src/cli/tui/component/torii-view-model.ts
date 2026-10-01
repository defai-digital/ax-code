import type { FujiRun } from "./fuji-view-model"

export type ToriiStyle = "torii-day" | "torii-night"
export function isToriiStyle(style: string | undefined): style is ToriiStyle {
  return style === "torii-day" || style === "torii-night"
}

/** Reference composition size shared by both renderers. */
export const TORII_COLUMNS = 76
export const TORII_ROWS = 24
export const TORII_PILLARS = { left: 28, right: 47, top: 7, base: 18 } as const
export const TORII_LINTEL_TOP = 5
export const TORII_LINTEL_TIE = 9
export const TORII_GROUND_TOP = 19
export const TORII_MOON = { x: 62, y: 2 } as const
export const TORII_LANTERNS = [16, 58] as const
export const TORII_PATH_SLABS = [30, 35, 40, 45] as const
/** Shrine hall glimpsed through the gate. */
export const TORII_SHRINE = { x0: 33, x1: 40, top: 11, base: 13 } as const
/** Paper lanterns hanging under the lintel. */
export const TORII_CHOCHIN = [31, 44] as const
/** Worshippers on the approach. */
export const TORII_FIGURES = [34, 40] as const
/** Fox guardians flanking the path. */
export const TORII_FOXES = [24, 51] as const
/** Night stars in row-major order, shared by both renderers. */
export const TORII_STARS = [
  { x: 4, y: 0 },
  { x: 12, y: 2 },
  { x: 21, y: 1 },
  { x: 55, y: 0 },
  { x: 68, y: 1 },
  { x: 73, y: 3 },
] as const
export const TORII_PETAL_COUNT = 10
export const TORII_CYCLE_MS = 2400

/** Palette shared by the text and pixel renderers. */
export const TORII_COLORS = {
  "torii-day": {
    sky: "#7ab5d3",
    skyBottom: "#e4f2da",
    vermilion: "#c33d1e",
    vermilionDark: "#7a2412",
    cap: "#2c2c3a",
    stone: "#9a9aa8",
    stoneDark: "#7a7a88",
    lantern: "#a8a094",
    flame: "#ffb14e",
    mountain: "#9ab8a8",
    tree: "#3d7a3d",
    path: "#c8c0b0",
    petal: "#e8a8bc",
    ground: "#5a7a4a",
    cloud: "#f2f8fc",
    robe: "#4a4a6a",
  },
  "torii-night": {
    sky: "#8ba0c8",
    skyBottom: "#1c2a55",
    vermilion: "#8a2a18",
    vermilionDark: "#4a1408",
    cap: "#14141e",
    stone: "#5a5a6e",
    stoneDark: "#3a3a4a",
    lantern: "#5a5648",
    flame: "#ff9a3c",
    mountain: "#1c2a48",
    tree: "#1e3a24",
    path: "#4a463e",
    petal: "#b07a92",
    ground: "#1a2a1a",
    cloud: "#2c3a5e",
    robe: "#2c2c44",
  },
} as const satisfies Record<ToriiStyle, Record<string, string>>

export function toriiBackground(style: ToriiStyle) {
  return style === "torii-day" ? "#8ec8e8" : "#0a1030"
}

/** Sample the vertical sky gradient. `t` is 0 at the top of the frame. */
export function toriiSkyRgb(style: ToriiStyle, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(toriiBackground(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(TORII_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

export type ToriiPetal = { x: number; y: number }
/** Deterministic falling petals looping with the train-free 2400ms cycle. */
export function toriiPetals(elapsedMs: number): ToriiPetal[] {
  const phase = (Math.max(0, elapsedMs) % TORII_CYCLE_MS) / TORII_CYCLE_MS
  return Array.from({ length: TORII_PETAL_COUNT }, (_, i) => {
    const y = 4 + ((((i * 13 + 2) % 13) + phase * (6 + (i % 3) * 2)) % 13)
    const sway = Math.sin(2 * Math.PI * (phase + i / TORII_PETAL_COUNT)) * 2
    const drifted = ((i * 23 + 9) % TORII_COLUMNS) - phase * 6 + sway
    const x = ((drifted % TORII_COLUMNS) + TORII_COLUMNS) % TORII_COLUMNS
    return { x: Math.floor(x), y: Math.floor(y) }
  })
}

/** Stone-lantern flames flicker together on a 400ms beat, bright at rest. */
export function toriiFlicker(elapsedMs: number): boolean {
  return Math.floor(Math.max(0, elapsedMs) / 200) % 2 === 0
}

export function toriiRows(columns: number, rows: number, style: ToriiStyle, elapsedMs: number): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const night = style === "torii-night"
  const colors = TORII_COLORS[style]
  const flame = toriiFlicker(elapsedMs)
  const grid: FujiRun[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: colors.sky })),
  )
  const left = Math.floor((width - TORII_COLUMNS) / 2),
    top = Math.floor((height - TORII_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + Math.round(y)
    if (row < 0 || row >= height) return
    for (let i = 0; i < text.length; i++) {
      const sceneX = Math.round(x) + i
      const column = left + sceneX
      if (sceneX < 0 || sceneX >= TORII_COLUMNS || column < 0 || column >= width) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }
  if (night) {
    TORII_STARS.forEach((star, i) => {
      paint(star.x, star.y, (Math.floor(Math.max(0, elapsedMs) / 400) + i) % 3 === 0 ? "*" : ".", colors.sky)
    })
    paint(TORII_MOON.x - 1, TORII_MOON.y - 1, ".-.", colors.stone)
    paint(TORII_MOON.x - 2, TORII_MOON.y, "(   )", colors.stone)
  }
  // Distant peaks with cedar clusters behind the gate.
  for (let x = 3; x < TORII_COLUMNS; x += 13) {
    paint(x, 8, "/\\", colors.mountain)
  }
  paint(0, 9, " ".repeat(TORII_COLUMNS), colors.mountain, colors.mountain)
  paint(0, 10, " ".repeat(TORII_COLUMNS), colors.mountain, colors.mountain)
  for (const tree of [6, 10, 66, 70]) {
    paint(tree, 12, "/\\", colors.tree)
    paint(tree, 13, "||", colors.tree)
  }
  // Bamboo clusters at the far edges.
  for (const stalk of [2, 73]) {
    paint(stalk, 14, "|", colors.tree)
    paint(stalk, 15, "|", colors.tree)
    paint(stalk, 16, "|", colors.tree)
  }
  paint(1, 14, "/", colors.tree)
  paint(74, 14, "\\", colors.tree)
  // Shrine hall glimpsed through the gate.
  const shrine = TORII_SHRINE
  paint(shrine.x0, shrine.top, "/------\\", colors.cap)
  paint(shrine.x0 + 1, shrine.top + 1, "| [] |", colors.vermilionDark, colors.vermilion)
  paint(shrine.x0 + 1, shrine.top + 2, "|    |", colors.vermilionDark, colors.vermilion)
  const pillars = TORII_PILLARS
  // Curved top lintel with a dark cap, then the tie beam.
  paint(pillars.left - 4, TORII_LINTEL_TOP, "_" + "=".repeat(pillars.right - pillars.left + 7) + "_", colors.vermilion)
  paint(
    pillars.left - 4,
    TORII_LINTEL_TOP + 1,
    " " + "#".repeat(pillars.right - pillars.left + 7) + " ",
    colors.cap,
    colors.vermilionDark,
  )
  for (let y = pillars.top; y <= pillars.base; y++) {
    paint(pillars.left, y, "||", colors.vermilionDark, colors.vermilion)
    paint(pillars.right, y, "||", colors.vermilionDark, colors.vermilion)
  }
  paint(pillars.left - 1, TORII_LINTEL_TIE, "=".repeat(pillars.right - pillars.left + 4), colors.vermilionDark)
  paint(pillars.left - 2, pillars.base + 1, "=".repeat(6), colors.stone)
  paint(pillars.right - 2, pillars.base + 1, "=".repeat(6), colors.stone)
  // Paper lanterns hanging under the lintel.
  for (const chochin of TORII_CHOCHIN) {
    paint(chochin, pillars.top, "()", colors.flame)
  }
  // Fox guardians flanking the path.
  for (const fox of TORII_FOXES) {
    paint(fox, 17, "/\\", colors.stone)
    paint(fox, 18, "||", colors.stoneDark)
  }
  // Worshippers on the approach.
  for (const figure of TORII_FIGURES) {
    paint(figure, 17, "o", colors.robe)
    paint(figure, 18, "|", colors.robe)
  }
  // Stone lanterns flanking the approach.
  for (const lantern of TORII_LANTERNS) {
    paint(lantern - 1, 14, "=====", colors.stoneDark)
    paint(lantern, 15, flame ? "[*]" : "[ ]", flame ? colors.flame : colors.lantern, colors.lantern)
    paint(lantern, 16, "|_|", colors.stoneDark)
  }
  for (const petal of toriiPetals(elapsedMs)) {
    const row = top + petal.y
    if (row < 0 || row >= height) continue
    const column = left + petal.x
    if (petal.x < 0 || petal.x >= TORII_COLUMNS || column < 0 || column >= width) continue
    const cell = grid[row]![column]!
    grid[row]![column] = { text: ".", color: colors.petal, background: cell.background }
  }
  for (let y = TORII_GROUND_TOP; y < TORII_ROWS; y++) {
    paint(0, y, " ".repeat(TORII_COLUMNS), colors.ground, colors.ground)
  }
  for (const slab of TORII_PATH_SLABS) {
    paint(slab, TORII_GROUND_TOP + 1, "===", colors.path, colors.ground)
  }
  // Foreground grasses wave below the path.
  for (let x = 1; x < TORII_COLUMNS; x += 6) {
    paint(x, TORII_GROUND_TOP + 3, '"', colors.tree, colors.ground)
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
