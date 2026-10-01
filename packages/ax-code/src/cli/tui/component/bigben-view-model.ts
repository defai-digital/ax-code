import type { FujiRun } from "./fuji-view-model"

export type BigbenStyle = "bigben-day" | "bigben-night"
export function isBigbenStyle(style: string | undefined): style is BigbenStyle {
  return style === "bigben-day" || style === "bigben-night"
}

/** Reference composition size shared by both renderers. */
export const BIGBEN_COLUMNS = 76
export const BIGBEN_ROWS = 24
export const BIGBEN_TOWER = { x0: 34, x1: 41, top: 5, base: 19 } as const
export const BIGBEN_FACE = { cx: 37.5, cy: 8, r: 2.4 } as const
export const BIGBEN_GROUND_TOP = 20
export const BIGBEN_WATER_TOP = 21
export const BIGBEN_MOON = { x: 12, y: 2 } as const
export const BIGBEN_LAMPS = [10, 26, 50, 66] as const
export const BIGBEN_ABBEY = { x0: 52, x1: 70, top: 15, base: 19 } as const
/** Westminster Bridge arch feet along the quay. */
export const BIGBEN_BRIDGE = [0, 6, 12, 18] as const
/** Night stars in row-major order, shared by both renderers. */
export const BIGBEN_STARS = [
  { x: 3, y: 0 },
  { x: 9, y: 1 },
  { x: 20, y: 0 },
  { x: 27, y: 2 },
  { x: 52, y: 1 },
  { x: 60, y: 0 },
  { x: 67, y: 2 },
  { x: 72, y: 1 },
] as const

/** Palette shared by the text and pixel renderers. */
export const BIGBEN_COLORS = {
  "bigben-day": {
    sky: "#7ab5d3",
    skyBottom: "#d8f0f8",
    stone: "#c9bfa8",
    stoneDark: "#8a8272",
    stoneLight: "#ddd6c2",
    arch: "#6a6252",
    face: "#f5f2e8",
    hand: "#2a2a3a",
    window: "#4a6a8a",
    ground: "#5a7a4a",
    water: "#3d7a9a",
    waterDeep: "#2c525e",
    lampGlow: "#fff3c8",
    abbey: "#a8b8c8",
    cloud: "#eef6fb",
    bus: "#b83a3a",
    beam: "#fff8dc",
    rail: "#5a5245",
  },
  "bigben-night": {
    sky: "#8ba0c8",
    skyBottom: "#1c2a55",
    stone: "#4a4a62",
    stoneDark: "#2c2c40",
    stoneLight: "#5a5a72",
    arch: "#1a1a28",
    face: "#ffe9a8",
    hand: "#1a1a2a",
    window: "#ffd166",
    ground: "#1a2a1a",
    water: "#1a2a4a",
    waterDeep: "#0e1830",
    lampGlow: "#ffd166",
    abbey: "#2c3a5e",
    cloud: "#2c3a5e",
    bus: "#7a2a2a",
    beam: "#ffe9a8",
    rail: "#2a2a38",
  },
} as const satisfies Record<BigbenStyle, Record<string, string>>

export function bigbenBackground(style: BigbenStyle) {
  return style === "bigben-day" ? "#8ec8e8" : "#0a1030"
}

/** Sample the vertical sky gradient. `t` is 0 at the top of the frame. */
export function bigbenSkyRgb(style: BigbenStyle, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(bigbenBackground(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(BIGBEN_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

/** Clock hands on a 2400ms round: the minute hand laps once, the hour hand creeps. */
export function bigbenHands(elapsedMs: number): {
  minute: { x: number; y: number }[]
  hour: { x: number; y: number }[]
} {
  const phase = (Math.max(0, elapsedMs) % 2400) / 2400
  const minuteAngle = 2 * Math.PI * phase - Math.PI / 2
  const hourAngle = 2 * Math.PI * (phase / 12 + 0.3) - Math.PI / 2
  const arm = (angle: number, length: number) =>
    Array.from({ length }, (_, i) => ({
      x: Math.round(BIGBEN_FACE.cx + Math.cos(angle) * (i + 1)),
      y: Math.round(BIGBEN_FACE.cy + Math.sin(angle) * (i + 1) * 0.8),
    }))
  return { minute: arm(minuteAngle, 2), hour: arm(hourAngle, 1) }
}

/** Slow clouds cross the sky on an 18400ms round. */
export function bigbenClouds(elapsedMs: number): { x: number; y: number }[] {
  const t = Math.max(0, elapsedMs)
  const cycle = BIGBEN_COLUMNS + 16
  return [0, 1, 2].map((i) => ({
    x: (((i * 29 + 7 - Math.floor(t / 400) * 2) % cycle) + cycle) % cycle,
    y: 2 + i * 3,
  }))
}

/** Thames shimmer column shift on a 900ms round. */
export function bigbenShimmer(elapsedMs: number): number {
  return Math.floor(Math.max(0, elapsedMs) / 300) % 3
}

/** Spire flag ripple phase 0..2 advancing every 300ms. */
export function bigbenFlag(elapsedMs: number): number {
  return Math.floor(Math.max(0, elapsedMs) / 300) % 3
}

/** Double-decker bus crossing the embankment, one column per 100ms. */
export function bigbenBus(elapsedMs: number): number {
  return -12 + Math.floor(Math.max(0, elapsedMs) / 100)
}

export type BigbenBird = { x: number; y: number }
/** Rooks circling the tower on a slow round. */
export function bigbenBirds(elapsedMs: number): BigbenBird[] {
  const t = Math.max(0, elapsedMs) / 600
  return [0, 1, 2].map((i) => ({
    x: 38 + Math.round(Math.cos(t + i * 2.1) * 14),
    y: 6 + Math.round(Math.sin(t + i * 2.1) * 3),
  }))
}

export function bigbenRows(columns: number, rows: number, style: BigbenStyle, elapsedMs: number): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const night = style === "bigben-night"
  const colors = BIGBEN_COLORS[style]
  const shimmer = bigbenShimmer(elapsedMs)
  const flag = bigbenFlag(elapsedMs)
  const grid: FujiRun[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: colors.sky })),
  )
  const left = Math.floor((width - BIGBEN_COLUMNS) / 2),
    top = Math.floor((height - BIGBEN_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + Math.round(y)
    if (row < 0 || row >= height) return
    for (let i = 0; i < text.length; i++) {
      const sceneX = Math.round(x) + i
      const column = left + sceneX
      if (sceneX < 0 || sceneX >= BIGBEN_COLUMNS || column < 0 || column >= width) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }
  for (const cloud of bigbenClouds(elapsedMs)) {
    paint(cloud.x, cloud.y, "~~~~~", colors.cloud)
  }
  if (night) {
    BIGBEN_STARS.forEach((star, i) => {
      paint(star.x, star.y, (Math.floor(Math.max(0, elapsedMs) / 400) + i) % 3 === 0 ? "*" : ".", colors.sky)
    })
    paint(BIGBEN_MOON.x - 1, BIGBEN_MOON.y - 1, ".-.", colors.face)
    paint(BIGBEN_MOON.x - 2, BIGBEN_MOON.y, "(   )", colors.face)
  }
  // Distant abbey silhouette behind the tower.
  const abbey = BIGBEN_ABBEY
  for (let y = abbey.top; y <= abbey.base; y++) {
    paint(abbey.x0, y, " ".repeat(abbey.x1 - abbey.x0 + 1), colors.abbey, colors.abbey)
  }
  paint(55, 13, "/\\", colors.abbey)
  paint(55, 14, "||", colors.abbey)
  paint(63, 13, "/\\", colors.abbey)
  paint(63, 14, "||", colors.abbey)
  for (let x = abbey.x0 + 2; x <= abbey.x1 - 2; x += 4) {
    paint(x, 17, "::", night ? colors.face : colors.stoneDark, colors.abbey)
  }
  // Spire narrowing to the tip, with corner pinnacles and a flag.
  paint(37, 1, "/\\", colors.stoneDark)
  paint(36, 2, "/  \\", colors.stoneDark)
  paint(35, 3, "/    \\", colors.stoneDark)
  paint(34, 4, "/______\\", colors.stoneDark)
  paint(33, 3, "/\\", colors.stoneDark)
  paint(33, 4, "||", colors.stoneDark, colors.stone)
  paint(42, 3, "/\\", colors.stoneDark)
  paint(42, 4, "||", colors.stoneDark, colors.stone)
  paint(38, 0, "|", colors.stoneDark)
  paint(39, 0, flag === 0 ? ">>" : flag === 1 ? "~~" : "<<", colors.face)
  const tower = BIGBEN_TOWER
  for (let y = tower.top; y <= tower.base; y++) {
    paint(tower.x0, y, "|" + " ".repeat(tower.x1 - tower.x0 - 1) + "|", colors.stoneDark, colors.stone)
  }
  paint(tower.x0 + 1, tower.top, " ".repeat(2), colors.stoneLight, colors.stoneLight)
  // String courses banding the shaft.
  for (const course of [11, 15]) {
    paint(tower.x0, course, "|" + "-".repeat(tower.x1 - tower.x0 - 1) + "|", colors.arch, colors.stone)
  }
  // Clock face with live hands.
  paint(35, 7, " ______ ", colors.hand, colors.face)
  paint(35, 8, "|      |", colors.hand, colors.face)
  paint(35, 9, "|______|", colors.hand, colors.face)
  const hands = bigbenHands(elapsedMs)
  paint(Math.round(BIGBEN_FACE.cx), Math.round(BIGBEN_FACE.cy), "+", colors.hand, colors.face)
  for (const cell of hands.minute) paint(cell.x, cell.y, "*", colors.hand, colors.face)
  for (const cell of hands.hour) paint(cell.x, cell.y, "o", colors.hand, colors.face)
  for (const y of [12, 14, 16, 18]) {
    paint(37, y - 1, "()", colors.arch, colors.stone)
    paint(37, y, night ? "##" : "::", colors.window, colors.stone)
  }
  // Floodlight raking the tower after dark.
  if (night) {
    paint(30, 19, "/", colors.beam)
    paint(31, 18, "/", colors.beam)
    paint(32, 17, "/", colors.beam)
    paint(33, 16, "/", colors.beam)
  }
  // Embankment lamps glowing over the quay.
  for (const lamp of BIGBEN_LAMPS) {
    paint(lamp, 17, night ? "*" : ".", colors.lampGlow)
    paint(lamp, 18, "|", colors.stoneDark)
    paint(lamp, 19, "|", colors.stoneDark)
  }
  // Westminster Bridge arches along the quay.
  for (const foot of BIGBEN_BRIDGE) {
    paint(foot, 19, "nn", colors.stoneDark)
  }
  // A double-decker crosses in front of the lamps.
  const bus = bigbenBus(elapsedMs)
  paint(bus, 17, "[" + "=".repeat(8) + "]", colors.stoneDark, colors.bus)
  paint(bus, 18, "[" + "=".repeat(8) + "]", colors.stoneDark, colors.bus)
  paint(bus + 1, 19, "o", colors.stoneDark)
  paint(bus + 8, 19, "o", colors.stoneDark)
  // Rooks circle the tower.
  for (const bird of bigbenBirds(elapsedMs)) {
    paint(bird.x, bird.y, "v", colors.stoneDark)
  }
  paint(0, BIGBEN_GROUND_TOP, " ".repeat(BIGBEN_COLUMNS), colors.ground, colors.ground)
  // Quay railing over the water.
  for (let x = 0; x < BIGBEN_COLUMNS; x += 5) {
    paint(x, BIGBEN_GROUND_TOP, "|", colors.rail, colors.ground)
  }
  // Thames with drifting shimmer and the clock reflection.
  for (let y = BIGBEN_WATER_TOP; y < BIGBEN_ROWS; y++) {
    for (let x = 0; x < BIGBEN_COLUMNS; x++) {
      const crest = (x + y + shimmer) % 6 === 0
      paint(
        x,
        y,
        crest ? "~" : "=",
        crest ? colors.lampGlow : colors.water,
        y > BIGBEN_WATER_TOP ? colors.waterDeep : colors.water,
      )
    }
  }
  paint(35, BIGBEN_WATER_TOP, "~~~~~", colors.face, colors.water)
  paint(35, BIGBEN_WATER_TOP + 1, "~~~~~", colors.face, colors.water)
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
