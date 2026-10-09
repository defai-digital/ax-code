import type { FujiRun } from "./fuji-view-model"
import { hdHex, hdMix, type RGB } from "./scene-hd"

export type SingaporeStyle = "singapore-day" | "singapore-night"
export function isSingaporeStyle(style: string | undefined): style is SingaporeStyle {
  return style === "singapore-day" || style === "singapore-night"
}

/** Illustrated Marina Bay composition shared by the text and HD painters. */
export const SINGAPORE_COLUMNS = 76
export const SINGAPORE_ROWS = 24
export const SINGAPORE_BAY_TOP = 18
export const SINGAPORE_TOWERS = [35, 46, 57] as const
export const SINGAPORE_SKYPARK = { x0: 29, x1: 64, y: 7 } as const
export const SINGAPORE_MERLION = { x: 14, mouthX: 17, mouthY: 12.9, base: 20 } as const
export const SINGAPORE_TREES = [
  { x: 3, top: 14, radius: 3.6 },
  { x: 68, top: 11, radius: 4.2 },
  { x: 74, top: 14, radius: 3 },
] as const
export const SINGAPORE_SKYLINE = [
  { x: 5, top: 11, width: 3 },
  { x: 10, top: 9, width: 3 },
  { x: 16, top: 10, width: 4 },
  { x: 23, top: 12, width: 3 },
  { x: 28, top: 14, width: 3 },
] as const
export const SINGAPORE_STARS = [
  { x: 6, y: 2 },
  { x: 25, y: 1 },
  { x: 40, y: 3 },
  { x: 55, y: 1 },
  { x: 71, y: 4 },
] as const
export const SINGAPORE_COLORS = {
  "singapore-day": {
    sky: "#548eab",
    skyBottom: "#f4d5aa",
    tower: "#a3b8be",
    shade: "#536e80",
    glass: "#6998aa",
    light: "#fff1bf",
    skyline: "#5d8193",
    green: "#42795e",
    canopy: "#75ac69",
    tree: "#697467",
    stone: "#fff2d5",
    stoneShade: "#b5bcaf",
    fountain: "#e6fafb",
    water: "#3f929d",
    waterDeep: "#164955",
    accent: "#e8bd79",
  },
  "singapore-night": {
    sky: "#07162d",
    skyBottom: "#34335b",
    tower: "#29384e",
    shade: "#131f36",
    glass: "#415478",
    light: "#ffd48c",
    skyline: "#17263e",
    green: "#1c4846",
    canopy: "#ce79dc",
    tree: "#3f3964",
    stone: "#dbebeb",
    stoneShade: "#799caa",
    fountain: "#b7f5ff",
    water: "#183751",
    waterDeep: "#081b30",
    accent: "#6ee3dc",
  },
} as const satisfies Record<SingaporeStyle, Record<string, string>>

export function singaporeBackground(style: SingaporeStyle): string {
  return SINGAPORE_COLORS[style].sky
}
export function singaporeSkyRgb(style: SingaporeStyle, t: number): RGB {
  const colors = SINGAPORE_COLORS[style]
  return hdMix(hdHex(colors.sky), hdHex(colors.skyBottom), t)
}
export function singaporePhase(elapsedMs: number): number {
  return ((Math.max(0, elapsedMs) % 6000) / 6000) * Math.PI * 2
}
/** Parabolic fountain stream, with a small continuous flutter along its length. */
export function singaporeJet(u: number, elapsedMs: number): { x: number; y: number } {
  const t = Math.max(0, Math.min(1, u))
  return {
    x: SINGAPORE_MERLION.mouthX + 15 * t,
    y: SINGAPORE_MERLION.mouthY - 5 * t + 11.9 * t * t + Math.sin(t * 24 - singaporePhase(elapsedMs) * 4) * 0.08 * t,
  }
}
/** The cabin drifts across the bay once within the default three-second clip. */
export function singaporeBoat(elapsedMs: number): { x: number; y: number } {
  return {
    x: 45 + Math.min(1, Math.max(0, elapsedMs) / 3000) * 12,
    y: 21 + Math.sin(singaporePhase(elapsedMs) * 2) * 0.12,
  }
}

export function singaporeRows(columns: number, rows: number, style: SingaporeStyle, elapsedMs: number): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const colors = SINGAPORE_COLORS[style]
  const night = style === "singapore-night"
  const phase = singaporePhase(elapsedMs)
  const grid: FujiRun[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: colors.sky })),
  )
  const left = Math.floor((width - SINGAPORE_COLUMNS) / 2),
    top = Math.floor((height - SINGAPORE_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + Math.round(y)
    if (row < 0 || row >= height) return
    for (let i = 0; i < text.length; i++) {
      const sceneX = Math.round(x) + i,
        column = left + sceneX
      if (sceneX < 0 || sceneX >= SINGAPORE_COLUMNS || column < 0 || column >= width) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }
  if (night) {
    SINGAPORE_STARS.forEach((star, i) => paint(star.x, star.y, Math.sin(phase * 2 + i) > 0 ? "*" : ".", colors.light))
    paint(63, 2, "( )", colors.light)
  } else {
    paint(8 + Math.sin(phase), 3, "~~ ~~", colors.stone)
    paint(37 + Math.sin(phase), 2, "~~~~~~", colors.stone)
    paint(63, 3, "O", colors.light)
  }
  for (let y = SINGAPORE_BAY_TOP; y < SINGAPORE_ROWS; y++) {
    paint(0, y, " ".repeat(SINGAPORE_COLUMNS), colors.water, colors.waterDeep)
    for (let x = (y * 7 + Math.floor(phase * 4)) % 9; x < SINGAPORE_COLUMNS; x += 9)
      paint(x, y, "~~", colors.water, colors.waterDeep)
  }
  for (const building of SINGAPORE_SKYLINE) {
    for (let y = building.top; y < SINGAPORE_BAY_TOP; y++)
      paint(
        building.x,
        y,
        y % 2 === 0 ? ":".repeat(building.width) : "|".repeat(building.width),
        night ? colors.light : colors.glass,
        colors.skyline,
      )
  }
  for (const x of SINGAPORE_TOWERS) {
    for (let y = 8; y < SINGAPORE_BAY_TOP; y++)
      paint(x - 3, y, "|:::::|", night ? colors.light : colors.glass, colors.tower)
    paint(x - 2, 19, "~|~", colors.accent, colors.waterDeep)
  }
  paint(SINGAPORE_SKYPARK.x0, 6, "_".repeat(36), colors.green)
  paint(SINGAPORE_SKYPARK.x0, 7, "\\" + "=".repeat(34) + "/", colors.light, colors.shade)
  for (const tree of SINGAPORE_TREES) {
    const radius = Math.round(tree.radius)
    paint(tree.x - radius, tree.top, "/" + "=".repeat(radius * 2 - 1) + "\\", colors.canopy)
    for (let y = tree.top + 1; y < SINGAPORE_BAY_TOP; y++)
      paint(tree.x - 1, y, "\\|/", night ? colors.accent : colors.tree)
  }
  // Lion head facing the bay, with a scaled fish body and curling tail.
  paint(11, 12, "{o_", colors.stone)
  paint(11, 13, "{  >==", colors.stone)
  paint(11, 14, "{_/|", colors.stone)
  for (let y = 15; y < 19; y++) paint(11, y, "/)))|", colors.stone, colors.stoneShade)
  paint(8, 19, "<___/)))", colors.stone)
  paint(8, 20, "========", colors.stoneShade, colors.stoneShade)
  for (let i = 0; i <= 45; i++) {
    const jet = singaporeJet(i / 45, elapsedMs)
    paint(jet.x, jet.y, i % 3 === 0 ? "." : "~", colors.fountain)
  }
  paint(30, 20, Math.sin(phase * 4) > 0 ? "*~*" : "~*~", colors.fountain, colors.waterDeep)
  const boat = singaporeBoat(elapsedMs)
  paint(boat.x, boat.y, "_[]_", colors.light, colors.waterDeep)
  paint(boat.x - 1, boat.y + 1, "\\____/", colors.accent, colors.waterDeep)
  paint(33, 23, "SINGAPORE", colors.light, colors.waterDeep)
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
