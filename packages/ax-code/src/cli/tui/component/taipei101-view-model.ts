import type { FujiRun } from "./fuji-view-model"

export type Taipei101Style = "taipei101-day" | "taipei101-neon"
export function isTaipei101Style(style: string | undefined): style is Taipei101Style {
  return style === "taipei101-day" || style === "taipei101-neon"
}

/** Reference composition size shared by both renderers. */
export const TAIPEI101_COLUMNS = 76
export const TAIPEI101_ROWS = 24
/** Five stacked tiers, bottom-up: each entry is [x0, x1, y0, y1]. */
export const TAIPEI101_TIERS = [
  [26, 49, 15, 17],
  [28, 47, 13, 14],
  [30, 45, 11, 12],
  [32, 43, 9, 10],
  [34, 41, 7, 8],
] as const
export const TAIPEI101_SPIRE = { x0: 37, x1: 38, top: 2, base: 6 } as const
export const TAIPEI101_PODIUM = { x0: 20, x1: 55, top: 17, base: 18 } as const
export const TAIPEI101_GROUND_TOP = 19
export const TAIPEI101_PARK_TOP = 21
export const TAIPEI101_CAR_ROW = 20
export const TAIPEI101_MOON = { x: 62, y: 2 } as const
export const TAIPEI101_TRACK_ROW = 13
/** Elevated-track pillars clear of the tower and the ranges. */
export const TAIPEI101_PILLARS = [22, 53] as const
/** Sky-lantern lanes rising past the tower. */
export const TAIPEI101_LANTERNS = [8, 60, 68] as const
/** Park trees and lamps along the forecourt. */
export const TAIPEI101_TREES = [8, 30, 52, 68] as const
export const TAIPEI101_PARK_LAMPS = [19, 57] as const
/** Night stars in row-major order, shared by both renderers. */
export const TAIPEI101_STARS = [
  { x: 4, y: 0 },
  { x: 11, y: 1 },
  { x: 19, y: 0 },
  { x: 56, y: 1 },
  { x: 66, y: 0 },
  { x: 72, y: 2 },
] as const

/** Palette shared by the text and pixel renderers. */
export const TAIPEI101_COLORS = {
  "taipei101-day": {
    sky: "#6aaed6",
    skyBottom: "#dcedf7",
    glass: "#9fc6dd",
    frame: "#3d5a73",
    lit: "#fff3b0",
    unlit: "#5a7a94",
    podium: "#8a9aa8",
    street: "#4a4a52",
    headlight: "#fff6da",
    beacon: "#ff5252",
    node: "#e8f2f8",
    mountain: "#9ab8a8",
    ground: "#6a8a5a",
    cloud: "#f2f8fc",
    tree: "#3d6a3d",
  },
  "taipei101-neon": {
    sky: "#93a7d8",
    skyBottom: "#1a2450",
    glass: "#1e3a5c",
    frame: "#ff5ad0",
    lit: "#ffe14e",
    unlit: "#2c4a6e",
    podium: "#232a4a",
    street: "#141828",
    headlight: "#fff6da",
    beacon: "#ff5252",
    node: "#ffe14e",
    mountain: "#1c2a48",
    ground: "#14251c",
    cloud: "#2c3a5e",
    tree: "#1e3a24",
  },
} as const satisfies Record<Taipei101Style, Record<string, string>>

export function taipei101Background(style: Taipei101Style) {
  return style === "taipei101-day" ? "#7ec0e4" : "#0c1233"
}

/** Sample the vertical sky gradient. `t` is 0 at the top of the frame. */
export function taipei101SkyRgb(style: Taipei101Style, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(taipei101Background(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(TAIPEI101_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

/** Window `i` lights on a shared 1600ms chase round. */
export function taipei101Lit(elapsedMs: number, i: number): boolean {
  return (Math.floor(Math.max(0, elapsedMs) / 400) + i) % 4 === 0
}

/** Spire beacon blinks on a 1200ms beat, bright at rest. */
export function taipei101Beacon(elapsedMs: number): boolean {
  return Math.floor(Math.max(0, elapsedMs) / 600) % 2 === 0
}

export type Taipei101Car = { x: number; dir: 1 | -1 }
/** Two cars cross the street in opposite directions with wraparound laps. */
export function taipei101Cars(elapsedMs: number): Taipei101Car[] {
  const t = Math.max(0, elapsedMs)
  return [
    { x: ((t / 50) % 80) - 2, dir: 1 },
    { x: 78 - ((t / 60) % 80), dir: -1 },
  ]
}

/** MRT train gliding behind the tower on its elevated track. */
export function taipei101Train(elapsedMs: number): number {
  return ((Math.max(0, elapsedMs) / 40) % 100) - 12
}

export type Taipei101Lantern = { x: number; y: number }
/** Sky lanterns rising past the tower on staggered laps. */
export function taipei101Lanterns(elapsedMs: number): Taipei101Lantern[] {
  const step = Math.floor(Math.max(0, elapsedMs) / 400)
  return TAIPEI101_LANTERNS.map((lane, i) => ({ x: lane, y: 16 - ((step + i * 5) % 15) }))
}

/** Slow clouds cross the sky on a 17600ms round. */
export function taipei101Clouds(elapsedMs: number): { x: number; y: number }[] {
  const t = Math.max(0, elapsedMs)
  const cycle = TAIPEI101_COLUMNS + 12
  return [0, 1].map((i) => ({
    x: (((i * 41 + 5 - Math.floor(t / 400) * 2) % cycle) + cycle) % cycle,
    y: 3 + i * 4,
  }))
}

export function taipei101Rows(columns: number, rows: number, style: Taipei101Style, elapsedMs: number): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const neon = style === "taipei101-neon"
  const colors = TAIPEI101_COLORS[style]
  const grid: FujiRun[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: colors.sky })),
  )
  const left = Math.floor((width - TAIPEI101_COLUMNS) / 2),
    top = Math.floor((height - TAIPEI101_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + Math.round(y)
    if (row < 0 || row >= height) return
    for (let i = 0; i < text.length; i++) {
      const sceneX = Math.round(x) + i
      const column = left + sceneX
      if (sceneX < 0 || sceneX >= TAIPEI101_COLUMNS || column < 0 || column >= width) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }
  for (const cloud of taipei101Clouds(elapsedMs)) {
    paint(cloud.x, cloud.y, "~~~~", colors.cloud)
  }
  if (neon) {
    TAIPEI101_STARS.forEach((star, i) => {
      paint(star.x, star.y, taipei101Lit(elapsedMs, i) ? "*" : ".", colors.sky)
    })
    paint(TAIPEI101_MOON.x - 1, TAIPEI101_MOON.y - 1, ".-.", colors.lit)
    paint(TAIPEI101_MOON.x - 2, TAIPEI101_MOON.y, "(   )", colors.lit)
  }
  // Elevated MRT track with pillars, running behind the tower.
  paint(0, TAIPEI101_TRACK_ROW, "=".repeat(TAIPEI101_COLUMNS), colors.frame)
  for (const pillar of TAIPEI101_PILLARS) {
    paint(pillar, 14, "|", colors.frame)
    paint(pillar, 15, "|", colors.frame)
    paint(pillar, 16, "|", colors.frame)
  }
  paint(taipei101Train(elapsedMs), TAIPEI101_TRACK_ROW - 1, "[====]", colors.frame, colors.lit)
  // Distant ridges flanking the tower.
  for (const [mx0, mx1] of [
    [0, 19],
    [56, 75],
  ]) {
    paint(mx0, 14, "/\\/\\/\\/\\/\\", colors.mountain)
    for (let y = 15; y <= 16; y++) {
      paint(mx0, y, " ".repeat(mx1 - mx0 + 1), colors.mountain, colors.mountain)
    }
  }
  // Sky lanterns rising past the tower.
  for (const lantern of taipei101Lanterns(elapsedMs)) {
    paint(lantern.x, lantern.y, "o", colors.lit)
    paint(lantern.x, lantern.y + 1, ".", colors.beacon)
  }
  const spire = TAIPEI101_SPIRE
  for (let y = spire.top; y <= spire.base; y++) {
    paint(spire.x0, y, "||", colors.frame, colors.glass)
  }
  const beacon = taipei101Beacon(elapsedMs)
  paint(37, 1, beacon ? "*" : ".", beacon ? colors.beacon : colors.frame)
  let windowIndex = 0
  for (const [x0, x1, y0, y1] of TAIPEI101_TIERS) {
    for (let y = y0; y <= y1; y++) {
      paint(x0, y, "[" + " ".repeat(x1 - x0 - 1) + "]", colors.frame, colors.glass)
      for (let x = x0 + 2; x <= x1 - 2; x += 3) {
        const lit = taipei101Lit(elapsedMs, windowIndex++)
        paint(x, y, lit ? "##" : "::", lit ? colors.lit : colors.unlit, colors.glass)
      }
    }
    paint(x0, y0, "[", colors.node, colors.glass)
    paint(x1, y0, "]", colors.node, colors.glass)
  }
  // Mall podium with a lit entrance.
  const podium = TAIPEI101_PODIUM
  for (let y = podium.top; y <= podium.base; y++) {
    paint(podium.x0, y, " ".repeat(podium.x1 - podium.x0 + 1), colors.podium, colors.podium)
  }
  paint(podium.x0, podium.top, "=".repeat(podium.x1 - podium.x0 + 1), colors.frame, colors.podium)
  paint(36, podium.base, "[  ]", colors.lit, colors.podium)
  // Roof gardens cap the podium clear of the track pillars.
  paint(23, 16, "^^", colors.tree)
  paint(51, 16, "^^", colors.tree)
  for (let y = TAIPEI101_GROUND_TOP; y < TAIPEI101_PARK_TOP; y++) {
    paint(0, y, " ".repeat(TAIPEI101_COLUMNS), colors.street, colors.street)
  }
  for (let x = 0; x < TAIPEI101_COLUMNS; x += 4) {
    paint(x, TAIPEI101_GROUND_TOP, "-", colors.frame, colors.street)
  }
  for (const car of taipei101Cars(elapsedMs)) {
    paint(Math.round(car.x), TAIPEI101_CAR_ROW, "o", colors.headlight, colors.street)
    paint(Math.round(car.x) - 2 * car.dir, TAIPEI101_CAR_ROW, "-", colors.beacon, colors.street)
  }
  for (let y = TAIPEI101_PARK_TOP; y < TAIPEI101_ROWS; y++) {
    paint(0, y, " ".repeat(TAIPEI101_COLUMNS), colors.ground, colors.ground)
  }
  // Park trees and lamps along the forecourt.
  for (const tree of TAIPEI101_TREES) {
    paint(tree, TAIPEI101_PARK_TOP, "/\\", colors.tree, colors.ground)
    paint(tree, TAIPEI101_PARK_TOP + 1, "||", colors.tree, colors.ground)
  }
  for (const lamp of TAIPEI101_PARK_LAMPS) {
    paint(lamp, TAIPEI101_PARK_TOP, "*", colors.headlight, colors.ground)
    paint(lamp, TAIPEI101_PARK_TOP + 1, "|", colors.frame, colors.ground)
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
