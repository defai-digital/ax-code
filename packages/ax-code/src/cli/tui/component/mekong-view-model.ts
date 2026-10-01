import type { FujiRun } from "./fuji-view-model"

export type MekongStyle = "mekong-dawn" | "mekong-dusk"
export function isMekongStyle(style: string | undefined): style is MekongStyle {
  return style === "mekong-dawn" || style === "mekong-dusk"
}

/** Reference composition size shared by both renderers. */
export const MEKONG_COLUMNS = 76
export const MEKONG_ROWS = 24
export const MEKONG_WATER_TOP = 14
export const MEKONG_SUN = { x: 60, y: 4 } as const
export const MEKONG_BOAT_X = 30
export const MEKONG_PALMS = [6, 66] as const
/** Distant skiff holding still upstream. */
export const MEKONG_DISTANT_X = 50
/** Riverside grass tufts keeping clear of boats. */
export const MEKONG_GRASS = [2, 9, 16, 23, 37, 44, 58, 65, 72] as const
export const MEKONG_HUT_X = 70
export const MEKONG_TEMPLE_X = 14
/** Lily pads resting on the lower river: [x, y]. */
export const MEKONG_LILIES = [
  [12, 19],
  [20, 21],
  [48, 20],
  [64, 19],
] as const

/** Palette shared by the text and pixel renderers. */
export const MEKONG_COLORS = {
  "mekong-dawn": {
    sky: "#9db8d8",
    skyBottom: "#f2d8b0",
    sun: "#ffd98a",
    sunGlow: "#f0a85e",
    water: "#4a8a9a",
    waterDeep: "#2c525e",
    shimmer: "#ffe9b0",
    boat: "#6a4a32",
    hat: "#d8b84a",
    palm: "#3d6a3d",
    egret: "#f2f2f2",
    grass: "#4a7a4a",
    goods: "#e88a3a",
    hut: "#8a6a4a",
    lily: "#4a8a4a",
  },
  "mekong-dusk": {
    sky: "#a86a7a",
    skyBottom: "#e88a5a",
    sun: "#ff9a4a",
    sunGlow: "#c33d2e",
    water: "#5a4a7a",
    waterDeep: "#33284a",
    shimmer: "#ffb87a",
    boat: "#4a3222",
    hat: "#b08a3a",
    palm: "#2c4a2c",
    egret: "#e8d8d8",
    grass: "#3a5a3a",
    goods: "#c36a2a",
    hut: "#5a4232",
    lily: "#3a6a3a",
  },
} as const satisfies Record<MekongStyle, Record<string, string>>

export function mekongBackground(style: MekongStyle) {
  return style === "mekong-dawn" ? "#a8c4e0" : "#7a4a62"
}

/** Sample the vertical sky gradient. `t` is 0 at the top of the frame. */
export function mekongSkyRgb(style: MekongStyle, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(mekongBackground(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(MEKONG_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

/** Boat bob offset -1..1 on a 1200ms round. */
export function mekongBob(elapsedMs: number): number {
  return Math.round(Math.sin((Math.max(0, elapsedMs) / 1200) * Math.PI * 2))
}

/** Water shimmer column shift on a 900ms round. */
export function mekongShimmer(elapsedMs: number): number {
  return Math.floor(Math.max(0, elapsedMs) / 300) % 3
}

/** Floating-market boat drifting down from the right, one column per 120ms. */
export function mekongMarket(elapsedMs: number): number {
  return 70 - Math.floor(Math.max(0, elapsedMs) / 120)
}

export type MekongEgret = { x: number; y: number }
/** Two egrets crossing the sky in opposite directions. */
export function mekongEgrets(elapsedMs: number): MekongEgret[] {
  const t = Math.max(0, elapsedMs)
  return [
    { x: (5 + Math.floor(t / 350)) % MEKONG_COLUMNS, y: 7 },
    {
      x: ((70 - Math.floor(t / 450) + MEKONG_COLUMNS) % MEKONG_COLUMNS + MEKONG_COLUMNS) % MEKONG_COLUMNS,
      y: 5,
    },
  ]
}

export function mekongRows(columns: number, rows: number, style: MekongStyle, elapsedMs: number): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const colors = MEKONG_COLORS[style]
  const bob = mekongBob(elapsedMs)
  const shimmer = mekongShimmer(elapsedMs)
  const grid: FujiRun[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: colors.sky })),
  )
  const left = Math.floor((width - MEKONG_COLUMNS) / 2),
    top = Math.floor((height - MEKONG_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + Math.round(y)
    if (row < 0 || row >= height) return
    for (let i = 0; i < text.length; i++) {
      const sceneX = Math.round(x) + i
      const column = left + sceneX
      if (sceneX < 0 || sceneX >= MEKONG_COLUMNS || column < 0 || column >= width) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }
  paint(MEKONG_SUN.x - 2, MEKONG_SUN.y - 1, ".---.", colors.sun, colors.sunGlow)
  paint(MEKONG_SUN.x - 3, MEKONG_SUN.y, "(     )", colors.sun, colors.sunGlow)
  for (const palm of MEKONG_PALMS) {
    paint(palm, 9, "\\|/", colors.palm)
    paint(palm + 1, 10, "|", colors.palm)
    paint(palm + 1, 11, "|", colors.palm)
    paint(palm + 1, 12, "|", colors.palm)
  }
  // Riverside temple on the left bank.
  paint(MEKONG_TEMPLE_X + 1, 10, "/\\", colors.hut)
  paint(MEKONG_TEMPLE_X, 11, "|   |", colors.hut)
  paint(MEKONG_TEMPLE_X, 12, "|___|", colors.hut)
  // Stilt house on the right bank.
  paint(MEKONG_HUT_X, 10, "/--\\", colors.hut)
  paint(MEKONG_HUT_X, 11, "|[]|", colors.hut)
  paint(MEKONG_HUT_X, 12, "|  |", colors.hut)
  // Grass fringes the banks clear of the boats.
  for (const tuft of MEKONG_GRASS) {
    paint(tuft, MEKONG_WATER_TOP - 1, '"', colors.grass)
  }
  // Shimmering water with a sun reflection column.
  for (let y = MEKONG_WATER_TOP; y < MEKONG_ROWS; y++) {
    for (let x = 0; x < MEKONG_COLUMNS; x++) {
      const crest = (x + y + shimmer) % 6 === 0
      paint(
        x,
        y,
        crest ? "~" : "=",
        crest ? colors.shimmer : colors.water,
        y > MEKONG_WATER_TOP + 2 ? colors.waterDeep : colors.water,
      )
    }
  }
  paint(MEKONG_SUN.x - 2, MEKONG_WATER_TOP, "~~~~~", colors.shimmer, colors.water)
  paint(MEKONG_SUN.x - 2, MEKONG_WATER_TOP + 1, "~~~~~", colors.shimmer, colors.water)
  paint(MEKONG_SUN.x - 2, MEKONG_WATER_TOP + 2, "~~~~~", colors.shimmer, colors.waterDeep)
  paint(MEKONG_SUN.x - 1, MEKONG_WATER_TOP + 3, "~~~", colors.shimmer, colors.waterDeep)
  // Lily pads with one blossom on the lower river.
  for (const [padX, padY] of MEKONG_LILIES) {
    paint(padX, padY, "o", colors.lily, colors.waterDeep)
  }
  paint(48, 19, "*", colors.hat, colors.waterDeep)
  // Sampan with a conical-hatted rower riding the swell.
  const boatY = MEKONG_WATER_TOP + 2 + bob
  paint(MEKONG_BOAT_X, boatY - 3, "/\\", colors.hat)
  paint(MEKONG_BOAT_X - 1, boatY - 2, "/--\\", colors.hat)
  paint(MEKONG_BOAT_X + 1, boatY - 1, "|", colors.boat)
  paint(MEKONG_BOAT_X - 4, boatY, "\\________/", colors.boat)
  // Floating-market boat drifting down from the right.
  const marketX = mekongMarket(elapsedMs)
  paint(marketX + 1, 14, "ooo", colors.goods, colors.water)
  paint(marketX, 15, "\\____/", colors.boat)
  // A second skiff holds still upstream while egrets cross.
  paint(MEKONG_DISTANT_X + 2, MEKONG_WATER_TOP - 2, "|", colors.boat)
  paint(MEKONG_DISTANT_X, MEKONG_WATER_TOP - 1, "\\__/", colors.boat)
  for (const egret of mekongEgrets(elapsedMs)) {
    paint(egret.x, egret.y, "v", colors.egret)
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
