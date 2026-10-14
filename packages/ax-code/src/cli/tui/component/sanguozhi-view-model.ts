import type { FujiRun } from "./fuji-view-model"
import { createSceneGrid } from "./scene-grid"

export type SanguozhiStyle = "sanguozhi-muster" | "sanguozhi-dusk"
export function isSanguozhiStyle(style: string | undefined): style is SanguozhiStyle {
  return style === "sanguozhi-muster" || style === "sanguozhi-dusk"
}

/** Reference composition size shared by both renderers. */
export const SANGUOZHI_COLUMNS = 76
export const SANGUOZHI_ROWS = 24
/** City wall span; the gate tower rises from its center. */
export const SANGUOZHI_WALL = { x0: 4, x1: 72, top: 13, base: 18 } as const
export const SANGUOZHI_TOWER = { x0: 31, x1: 45, roofTop: 5, roofTie: 8, bodyTop: 9, bodyBase: 13 } as const
/** War-banner poles: left and right on the wall, the command banner over the tower roof. */
export const SANGUOZHI_BANNERS = [12, 38, 64] as const
export const SANGUOZHI_GROUND_TOP = 19
export const SANGUOZHI_SUN = { x: 62 } as const
export const SANGUOZHI_MOON = { x: 13, y: 2 } as const
/** Wall lanterns lit in the ending. */
export const SANGUOZHI_LANTERNS = [12, 24, 52, 64] as const
/** Campfires in the ending foreground. */
export const SANGUOZHI_CAMPFIRES = [20, 55] as const
export const SANGUOZHI_STARS = [
  { x: 5, y: 0 },
  { x: 19, y: 1 },
  { x: 30, y: 0 },
  { x: 48, y: 1 },
  { x: 58, y: 0 },
  { x: 71, y: 2 },
] as const
export const SANGUOZHI_RIDER_COUNT = 3
export const SANGUOZHI_CYCLE_MS = 3600

/** Palette shared by the text and pixel renderers. */
export const SANGUOZHI_COLORS = {
  "sanguozhi-muster": {
    sky: "#3a4470",
    skyBottom: "#e08a4e",
    sun: "#ffd98a",
    mountain: "#5a6480",
    mountainFar: "#7a7a94",
    wall: "#8a7a5e",
    wallDark: "#5e5040",
    roof: "#2e3440",
    timber: "#4a3226",
    bannerA: "#b03024",
    bannerB: "#28508a",
    bannerC: "#c08a28",
    ground: "#6a6a44",
    groundDark: "#4a4a30",
    rider: "#26221e",
    flame: "#ffb14e",
    mist: "#c8b89a",
    tree: "#3d5a34",
  },
  "sanguozhi-dusk": {
    sky: "#141c38",
    skyBottom: "#7a4a3a",
    sun: "#eef0ff",
    mountain: "#232c48",
    mountainFar: "#303a58",
    wall: "#4a4238",
    wallDark: "#2e2a24",
    roof: "#161a22",
    timber: "#2a1e16",
    bannerA: "#6e2018",
    bannerB: "#1a3050",
    bannerC: "#70501a",
    ground: "#2c3024",
    groundDark: "#1c1e16",
    rider: "#141210",
    flame: "#ff9a3c",
    mist: "#5a6478",
    tree: "#1e3020",
  },
} as const satisfies Record<SanguozhiStyle, Record<string, string>>

export function sanguozhiBackground(style: SanguozhiStyle) {
  return style === "sanguozhi-muster" ? "#2a3050" : "#0c1226"
}

/** Sample the vertical sky gradient. `t` is 0 at the top of the frame. */
export function sanguozhiSkyRgb(style: SanguozhiStyle, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(sanguozhiBackground(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(SANGUOZHI_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

/** The opening sun climbs a short arc over one cycle; the ending keeps the moon fixed. */
export function sanguozhiSunY(elapsedMs: number): number {
  const phase = (Math.max(0, elapsedMs) % SANGUOZHI_CYCLE_MS) / SANGUOZHI_CYCLE_MS
  return 5.2 - phase * 2.4
}

export type SanguozhiRider = { x: number; y: number; gallop: number }
/** Deterministic cavalry crossing the muster field, looping with the cycle. */
export function sanguozhiRiders(elapsedMs: number): SanguozhiRider[] {
  const phase = (Math.max(0, elapsedMs) % SANGUOZHI_CYCLE_MS) / SANGUOZHI_CYCLE_MS
  return Array.from({ length: SANGUOZHI_RIDER_COUNT }, (_, i) => {
    const x = -8 + phase * (SANGUOZHI_COLUMNS + 20) - i * 9
    return { x, y: 20 + (i % 2), gallop: (Math.floor(Math.max(0, elapsedMs) / 150) + i) % 2 }
  })
}

/** Banner cloth sways on a slow beat shared by both renderers. */
export function sanguozhiBannerSway(elapsedMs: number): number {
  return Math.sin((Math.max(0, elapsedMs) / SANGUOZHI_CYCLE_MS) * Math.PI * 2)
}

/** Lantern and campfire flames flicker together on a 400ms beat. */
export function sanguozhiFlicker(elapsedMs: number): boolean {
  return Math.floor(Math.max(0, elapsedMs) / 200) % 2 === 0
}

export function sanguozhiRows(columns: number, rows: number, style: SanguozhiStyle, elapsedMs: number): FujiRun[][] {
  const ending = style === "sanguozhi-dusk"
  const colors = SANGUOZHI_COLORS[style]
  const flame = sanguozhiFlicker(elapsedMs)
  const sway = sanguozhiBannerSway(elapsedMs) > 0
  const { paint, merge } = createSceneGrid({
    columns,
    rows,
    sceneColumns: SANGUOZHI_COLUMNS,
    sceneRows: SANGUOZHI_ROWS,
    sky: colors.sky,
  })
  const wall = SANGUOZHI_WALL
  const tower = SANGUOZHI_TOWER
  if (ending) {
    SANGUOZHI_STARS.forEach((star, i) => {
      paint(star.x, star.y, (Math.floor(Math.max(0, elapsedMs) / 400) + i) % 3 === 0 ? "*" : ".", colors.sun)
    })
    paint(SANGUOZHI_MOON.x - 1, SANGUOZHI_MOON.y - 1, ".-.", colors.sun)
    paint(SANGUOZHI_MOON.x - 2, SANGUOZHI_MOON.y, "(   )", colors.sun)
  } else {
    paint(SANGUOZHI_SUN.x - 1, sanguozhiSunY(elapsedMs) - 1, "\\|/", colors.sun)
    paint(SANGUOZHI_SUN.x - 1, sanguozhiSunY(elapsedMs), "-O-", colors.sun)
  }
  // Layered ridges behind the wall, with pine clusters on the near slope.
  for (let x = 2; x < SANGUOZHI_COLUMNS; x += 11) paint(x, 8, "/\\", colors.mountainFar)
  paint(0, 9, " ".repeat(SANGUOZHI_COLUMNS), colors.mountainFar, colors.mountainFar)
  for (let x = 5; x < SANGUOZHI_COLUMNS; x += 13) paint(x, 10, "/\\", colors.mountain)
  paint(0, 11, " ".repeat(SANGUOZHI_COLUMNS), colors.mountain, colors.mountain)
  paint(0, 12, " ".repeat(SANGUOZHI_COLUMNS), colors.mountain, colors.mountain)
  for (const tree of [4, 70]) {
    paint(tree, 11, "/\\", colors.tree)
    paint(tree, 12, "||", colors.tree)
  }
  // Gate tower: two upswept roof tiers over a timber body.
  paint(tower.x0 - 2, tower.roofTop, "/================\\", colors.roof)
  paint(tower.x0, tower.roofTop + 1, " ".repeat(tower.x1 - tower.x0), colors.timber, colors.timber)
  paint(tower.x0 - 3, tower.roofTie, "/======================\\", colors.roof)
  for (let y = tower.bodyTop; y < tower.bodyBase; y++) {
    paint(tower.x0, y, "|", colors.timber)
    paint(tower.x1 - 1, y, "|", colors.timber)
    if (ending && flame) paint(tower.x0 + 6, y, "*", colors.flame)
  }
  // Wall with crenellations and a dark gate arch.
  for (let x = wall.x0; x < wall.x1; x += 3) paint(x, wall.top, "##", colors.wallDark, colors.wall)
  for (let y = wall.top + 1; y <= wall.base; y++) {
    paint(wall.x0, y, " ".repeat(wall.x1 - wall.x0), colors.wall, colors.wall)
  }
  paint(36, wall.base - 2, "/--\\", colors.wallDark)
  paint(36, wall.base - 1, "|  |", colors.wallDark)
  paint(36, wall.base, "|  |", colors.wallDark)
  // War banners on their poles, cloth swinging with the sway beat. The
  // command banner flies from the tower roof instead of the wall walk.
  const bannerColors = [colors.bannerA, colors.bannerB, colors.bannerC]
  SANGUOZHI_BANNERS.forEach((pole, i) => {
    const base = i === 1 ? tower.roofTop : wall.top
    for (let y = base - 4; y < base; y++) paint(pole, y, "|", colors.timber)
    paint(pole + 1, base - 4, sway ? ">>" : ">-", bannerColors[i]!)
    paint(pole + 1, base - 3, sway ? ">-" : ">>", bannerColors[i]!)
  })
  if (ending) {
    for (const lantern of SANGUOZHI_LANTERNS) {
      paint(lantern, wall.top + 1, flame ? "(*)" : "( )", flame ? colors.flame : colors.wallDark, colors.wall)
    }
  }
  for (let y = SANGUOZHI_GROUND_TOP; y < SANGUOZHI_ROWS; y++) {
    paint(0, y, " ".repeat(SANGUOZHI_COLUMNS), colors.ground, colors.ground)
  }
  if (!ending) {
    for (const rider of sanguozhiRiders(elapsedMs)) {
      paint(rider.x, rider.y, rider.gallop ? "o_/\\" : "o_\\/", colors.rider, colors.ground)
      paint(rider.x, rider.y + 1, rider.gallop ? "/  \\" : "\\  /", colors.rider, colors.ground)
    }
  } else {
    for (const fire of SANGUOZHI_CAMPFIRES) {
      paint(fire, 21, flame ? " * " : " . ", colors.flame, colors.ground)
      paint(fire, 22, "/^\\", colors.groundDark, colors.ground)
    }
  }
  for (let x = 1; x < SANGUOZHI_COLUMNS; x += 6) {
    paint(x, SANGUOZHI_GROUND_TOP + 3, '"', colors.tree, colors.ground)
  }
  return merge()
}
