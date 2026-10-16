import type { FujiRun } from "./fuji-view-model"
import { createSceneGrid } from "./scene-grid"

export type RacingStyle = "racing-day" | "racing-night"
export function isRacingStyle(style: string | undefined): style is RacingStyle {
  return style === "racing-day" || style === "racing-night"
}

/** Reference composition size shared by both renderers. */
export const RACING_COLUMNS = 76
export const RACING_ROWS = 24
/** First road row; the highway widens from here toward the viewer. */
export const RACING_HORIZON = 9
export const RACING_CENTER_X = 38
export const RACING_SUN = { x: 12, y: 2 } as const
export const RACING_MOON = { x: 62, y: 2 } as const
/** Night stars in row-major order, shared by both renderers. */
export const RACING_STARS = [
  { x: 9, y: 1 },
  { x: 20, y: 3 },
  { x: 33, y: 0 },
  { x: 45, y: 2 },
  { x: 55, y: 5 },
  { x: 70, y: 1 },
] as const
/** Overhead sign gantry spanning the highway, posts at both edges. */
export const RACING_GANTRY = { x0: 18, x1: 57, beamY: 6, legBottom: 9 } as const
/** Player car anchor: rear-view sprite painted around rows 17-23. */
export const RACING_CAR = { x: 38, top: 17 } as const
export const RACING_CYCLE_MS = 2400

/** Palette shared by the text and pixel renderers. */
export const RACING_COLORS = {
  "racing-day": {
    sky: "#7ab5d3",
    skyBottom: "#cfe8f5",
    sun: "#ffdf6a",
    mountain: "#5a7a4a",
    mountainFar: "#87a86e",
    rock: "#8a8a86",
    grass: "#4a7a34",
    grassDark: "#33591f",
    asphalt: "#9aa0a8",
    asphaltBg: "#2c2e33",
    line: "#f0ead0",
    guardrail: "#b8bcc2",
    gantry: "#6a7078",
    sign: "#2e7d32",
    signText: "#e8f0e8",
    car: "#c8ccd4",
    carBg: "#14161a",
    glass: "#7ab5d3",
    tail: "#ff2a1e",
    plate: "#e8e8e8",
    rival: "#3a3e46",
    lamp: "#5a6068",
    hud: "#10222e",
    flame: "#ffb14e",
  },
  "racing-night": {
    sky: "#8ba0c8",
    skyBottom: "#b06a3a",
    sun: "#ffdf6a",
    mountain: "#1e2b22",
    mountainFar: "#2c3a30",
    rock: "#3a3f46",
    grass: "#1c3020",
    grassDark: "#122016",
    asphalt: "#6a707a",
    asphaltBg: "#16181d",
    line: "#d8c98a",
    guardrail: "#7a7f88",
    gantry: "#454b54",
    sign: "#1a4a20",
    signText: "#cfe0cf",
    car: "#ffb0a0",
    carBg: "#a81218",
    glass: "#2a3350",
    tail: "#ff5040",
    plate: "#d8d8d8",
    rival: "#22252c",
    lamp: "#ffd98a",
    hud: "#ffd98a",
    flame: "#ff9a3c",
  },
} as const satisfies Record<RacingStyle, Record<string, string>>

export function racingBackground(style: RacingStyle) {
  return style === "racing-day" ? "#8ec8e8" : "#141c38"
}

/** Sample the vertical sky gradient. `t` is 0 at the top of the frame. */
export function racingSkyRgb(style: RacingStyle, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(racingBackground(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(RACING_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

/** 200ms road beat looping bit-identically with the 2400ms cycle. */
export function racingTick(elapsedMs: number): number {
  return Math.floor(Math.max(0, elapsedMs) / 200) % 12
}

/** Exhaust puffs alternate on a 400ms beat, lit at rest. */
export function racingExhaust(elapsedMs: number): boolean {
  return Math.floor(Math.max(0, elapsedMs) / 200) % 2 === 0
}

/** HUD speed in KM/H, climbing one step per beat and looping with the cycle. */
export function racingSpeed(elapsedMs: number): number {
  return 148 + racingTick(elapsedMs) * 3
}

/** Road half-width in scene columns at a scene row, shared by both renderers. */
export function racingRoadHalf(row: number): number {
  const t = Math.max(0, Math.min(1, (row - RACING_HORIZON) / (RACING_ROWS - 1 - RACING_HORIZON)))
  return 5 + t * 26
}

export type RacingRival = { x: number; y: number }
/** Rival car ahead on the highway, weaving gently across its lane. */
export function racingRival(elapsedMs: number): RacingRival {
  const phase = (Math.max(0, elapsedMs) % RACING_CYCLE_MS) / RACING_CYCLE_MS
  return { x: RACING_CENTER_X - 4 + Math.round(Math.sin(2 * Math.PI * phase) * 3), y: 11 }
}

/** Player car sway in scene columns, one gentle weave per cycle. */
export function racingSway(elapsedMs: number): number {
  const phase = (Math.max(0, elapsedMs) % RACING_CYCLE_MS) / RACING_CYCLE_MS
  return Math.round(Math.sin(2 * Math.PI * phase))
}

/** Rear-view player car sprite, 20 columns wide, painted from RACING_CAR.top. */
export const RACING_CAR_LINES = [
  "     .-======-.     ",
  "    /  |    |  \\    ",
  "   |   ------   |   ",
  " ==--------------== ",
  "   |[]          []|   ",
  "   |    [AX-1]    |   ",
  "    \\_o________o_/    ",
] as const

export function racingRows(width: number, height: number, style: RacingStyle, elapsedMs: number): FujiRun[][] {
  const night = style === "racing-night"
  const colors = RACING_COLORS[style]
  const tick = racingTick(elapsedMs)
  const { paint, merge } = createSceneGrid({
    columns: width,
    rows: height,
    sceneColumns: RACING_COLUMNS,
    sceneRows: RACING_ROWS,
    sky: colors.sky,
  })
  // HUD echoing the arcade originals: speed top-left, lap top-right.
  paint(1, 0, `${racingSpeed(elapsedMs)} KMH`, colors.hud)
  paint(RACING_COLUMNS - 7, 0, "LAP 1", colors.hud)
  if (night) {
    RACING_STARS.forEach((star, i) => {
      paint(star.x, star.y, (Math.floor(Math.max(0, elapsedMs) / 400) + i) % 3 === 0 ? "*" : ".", colors.sky)
    })
    paint(RACING_MOON.x - 1, RACING_MOON.y - 1, ".-.", colors.plate)
    paint(RACING_MOON.x - 2, RACING_MOON.y, "(   )", colors.plate)
  } else {
    paint(RACING_SUN.x - 1, RACING_SUN.y - 1, "\\|/", colors.sun)
    paint(RACING_SUN.x - 1, RACING_SUN.y, "-o-", colors.sun)
    paint(RACING_SUN.x - 1, RACING_SUN.y + 1, "/|\\", colors.sun)
  }
  // Distant peaks and green mountain shoulders framing the pass.
  paint(8, 4, "/\\/\\", colors.mountainFar)
  paint(30, 3, "/\\", colors.mountainFar)
  paint(58, 4, "/\\/\\", colors.mountainFar)
  for (let y = 6; y < RACING_HORIZON; y++) {
    const reach = 18 + (y - 6) * 4
    paint(0, y, " ".repeat(reach), colors.mountain, colors.mountain)
    paint(RACING_COLUMNS - reach, y, " ".repeat(reach), colors.mountain, colors.mountain)
    paint(2 + (y % 3), y, ",", colors.grass, colors.mountain)
    paint(RACING_COLUMNS - 4 - (y % 3), y, ",", colors.grass, colors.mountain)
  }
  paint(4, 5, "/^^\\", colors.mountain)
  paint(RACING_COLUMNS - 8, 5, "/^^\\", colors.mountain)
  // Highway in chase perspective: grass verge, guardrails, asphalt, dashes.
  for (let y = RACING_HORIZON; y < RACING_ROWS; y++) {
    paint(0, y, " ".repeat(RACING_COLUMNS), colors.grassDark, colors.grass)
    const half = Math.round(racingRoadHalf(y))
    const left = RACING_CENTER_X - half
    const right = RACING_CENTER_X + half
    paint(left, y, " ".repeat(right - left), colors.asphalt, colors.asphaltBg)
    paint(left, y, "|", colors.line, colors.asphaltBg)
    paint(right - 1, y, "|", colors.line, colors.asphaltBg)
    if (y >= RACING_HORIZON + 3) {
      paint(left - 2, y, "=", colors.guardrail, colors.grass)
      paint(right + 1, y, "=", colors.guardrail, colors.grass)
    }
    // Lane dashes stream toward the viewer, three rows per dash pair.
    const dash = (((y - tick) % 3) + 3) % 3 === 0
    if (dash) {
      paint(RACING_CENTER_X - Math.round(half / 2), y, "|", colors.line, colors.asphaltBg)
      paint(RACING_CENTER_X, y, "|", colors.line, colors.asphaltBg)
      paint(RACING_CENTER_X + Math.round(half / 2), y, "|", colors.line, colors.asphaltBg)
    }
    // Street lamps march down both shoulders, lit only at night.
    if (y % 4 === tick % 4) {
      paint(left - 4, y, night ? "*" : "+", colors.lamp, colors.grass)
      paint(right + 3, y, night ? "*" : "+", colors.lamp, colors.grass)
    }
  }
  // Sign gantry overhead where the road leaves the pass.
  paint(RACING_GANTRY.x0, RACING_GANTRY.beamY, "=".repeat(RACING_GANTRY.x1 - RACING_GANTRY.x0), colors.gantry)
  for (let y = RACING_GANTRY.beamY + 1; y <= RACING_GANTRY.legBottom; y++) {
    paint(RACING_GANTRY.x0, y, "|", colors.gantry)
    paint(RACING_GANTRY.x1 - 1, y, "|", colors.gantry)
  }
  paint(RACING_CENTER_X - 4, RACING_GANTRY.beamY, "[ AX-1 ]", colors.signText, colors.sign)
  // Rival ahead, then the player car from behind.
  const rival = racingRival(elapsedMs)
  paint(rival.x, rival.y, "<##>", colors.rival, colors.asphaltBg)
  paint(rival.x + 1, rival.y + 1, "oo", colors.tail, colors.asphaltBg)
  const carX = RACING_CAR.x - 10 + racingSway(elapsedMs)
  RACING_CAR_LINES.forEach((line, i) => {
    paint(carX, RACING_CAR.top + i, line, colors.car, i >= 2 ? colors.carBg : undefined)
  })
  // Taillights and plate carry their own colors over the body paint.
  paint(carX + 4, RACING_CAR.top + 4, "[]", colors.tail, colors.carBg)
  paint(carX + 16, RACING_CAR.top + 4, "[]", colors.tail, colors.carBg)
  paint(carX + 8, RACING_CAR.top + 5, "[AX-1]", colors.plate, colors.carBg)
  if (racingExhaust(elapsedMs)) {
    paint(carX + 6, RACING_CAR.top + 6, "*", colors.flame, colors.carBg)
    paint(carX + 15, RACING_CAR.top + 6, "*", colors.flame, colors.carBg)
  }
  return merge()
}
