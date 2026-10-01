import type { FujiRun } from "./fuji-view-model"

export type GreatwallStyle = "greatwall-dawn" | "greatwall-dusk"
export function isGreatwallStyle(style: string | undefined): style is GreatwallStyle {
  return style === "greatwall-dawn" || style === "greatwall-dusk"
}

/** Reference composition size shared by both renderers. */
export const GREATWALL_COLUMNS = 76
export const GREATWALL_ROWS = 24
/** Ridge peaks the wall follows, left to right. */
export const GREATWALL_RIDGE = [14, 12, 10, 12, 14] as const
export const GREATWALL_TOWER = { x0: 33, x1: 42, top: 4, base: 11 } as const
export const GREATWALL_GROUND_TOP = 18
export const GREATWALL_SUN = { x: 60, y: 3 } as const
export const GREATWALL_FLAG_X = 44
export const GREATWALL_PINES = [6, 20, 50, 68] as const
export const GREATWALL_BIRD_COUNT = 3
/** Beacon smoke vent above the watchtower roof. */
export const GREATWALL_SMOKE_X = 37
/** Distant beacon tower silhouette on the far ridge. */
export const GREATWALL_FAR_TOWER = { x0: 58, x1: 62, top: 5, base: 8 } as const
/** Brazier columns riding the wall top. */
export const GREATWALL_BRAZIERS = [8, 67] as const

/** Palette shared by the text and pixel renderers. */
export const GREATWALL_COLORS = {
  "greatwall-dawn": {
    sky: "#9db8d8",
    skyBottom: "#f2d8b0",
    brick: "#8a6a52",
    brickDark: "#5a4232",
    brickLight: "#a88a6a",
    roof: "#3d5a73",
    sun: "#ffd98a",
    sunGlow: "#f0a85e",
    ridge: "#4a6a4a",
    ridgeFar: "#7a94a8",
    flag: "#c33d1e",
    pine: "#2c5a34",
    bird: "#3d3d4a",
    ground: "#3d5a3d",
    cloud: "#f7ecd8",
    smoke: "#c8c8c8",
    torch: "#ffd166",
  },
  "greatwall-dusk": {
    sky: "#b08a9a",
    skyBottom: "#e88a5a",
    brick: "#6a4a3a",
    brickDark: "#3d2a22",
    brickLight: "#8a5a44",
    roof: "#2c3a52",
    sun: "#ff9a4a",
    sunGlow: "#c33d2e",
    ridge: "#2c4a34",
    ridgeFar: "#8a5a6a",
    flag: "#e04a2a",
    pine: "#1e3a24",
    bird: "#2c2c3a",
    ground: "#22331f",
    cloud: "#d89a7a",
    smoke: "#e8b8a8",
    torch: "#ff9a4a",
  },
} as const satisfies Record<GreatwallStyle, Record<string, string>>

export function greatwallBackground(style: GreatwallStyle) {
  return style === "greatwall-dawn" ? "#a8c4e0" : "#7a4a62"
}

/** Sample the vertical sky gradient. `t` is 0 at the top of the frame. */
export function greatwallSkyRgb(style: GreatwallStyle, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(greatwallBackground(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(GREATWALL_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

/** Wall-top row at scene column `x`, following the ridge peaks. */
export function greatwallRidgeY(x: number): number {
  const segment = Math.max(0, Math.min(GREATWALL_RIDGE.length - 2, Math.floor(x / 15)))
  const from = GREATWALL_RIDGE[segment]!
  const to = GREATWALL_RIDGE[segment + 1]!
  return Math.round(from + ((to - from) * (x - segment * 15)) / 15)
}

/** Clouds drifting over the ridge on a 12000ms round. */
export function greatwallClouds(elapsedMs: number): { x: number; y: number }[] {
  const t = Math.max(0, elapsedMs)
  return [0, 1, 2].map((i) => ({
    x: (i * 27 + 9 + Math.floor(t / 500)) % (GREATWALL_COLUMNS + 14),
    y: 1 + i * 2,
  }))
}

/** Tower flag ripple phase 0..2 advancing every 300ms. */
export function greatwallFlag(elapsedMs: number): number {
  return Math.floor(Math.max(0, elapsedMs) / 300) % 3
}

export type GreatwallPuff = { x: number; y: number }
/** Beacon smoke puffs climbing past the roof on a 1400ms round. */
export function greatwallSmoke(elapsedMs: number): GreatwallPuff[] {
  const step = Math.floor(Math.max(0, elapsedMs) / 350) % 4
  return [0, 1, 2].map((i) => ({ x: GREATWALL_SMOKE_X, y: 3 - ((step + i) % 4) }))
}

/** Wall braziers flicker on a 500ms round, bright at rest. */
export function greatwallTorch(elapsedMs: number): boolean {
  return Math.floor(Math.max(0, elapsedMs) / 250) % 2 === 0
}

export type GreatwallEagle = { x: number; y: number }
/** An eagle soaring lazy circles above the ridge. */
export function greatwallEagle(elapsedMs: number): GreatwallEagle {
  const t = Math.max(0, elapsedMs) / 900
  return { x: 20 + Math.round(Math.cos(t) * 16), y: 5 + Math.round(Math.sin(t) * 2) }
}

export type GreatwallBird = { x: number; y: number }
/** Swifts crossing the sky on a 3600ms round. */
export function greatwallBirds(elapsedMs: number): GreatwallBird[] {
  const t = Math.max(0, elapsedMs)
  return Array.from({ length: GREATWALL_BIRD_COUNT }, (_, i) => ({
    x: (i * 27 + 6 + Math.floor(t / 300) * 2) % (GREATWALL_COLUMNS + 8),
    y: 2 + i,
  }))
}

export function greatwallRows(columns: number, rows: number, style: GreatwallStyle, elapsedMs: number): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const colors = GREATWALL_COLORS[style]
  const flag = greatwallFlag(elapsedMs)
  const grid: FujiRun[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: colors.sky })),
  )
  const left = Math.floor((width - GREATWALL_COLUMNS) / 2),
    top = Math.floor((height - GREATWALL_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + Math.round(y)
    if (row < 0 || row >= height) return
    for (let i = 0; i < text.length; i++) {
      const sceneX = Math.round(x) + i
      const column = left + sceneX
      if (sceneX < 0 || sceneX >= GREATWALL_COLUMNS || column < 0 || column >= width) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }
  paint(GREATWALL_SUN.x - 2, GREATWALL_SUN.y - 1, ".---.", colors.sun, colors.sunGlow)
  paint(GREATWALL_SUN.x - 3, GREATWALL_SUN.y, "(     )", colors.sun, colors.sunGlow)
  for (const cloud of greatwallClouds(elapsedMs)) {
    paint(cloud.x, cloud.y, "~~~~~~", colors.cloud)
  }
  for (const bird of greatwallBirds(elapsedMs)) {
    paint(bird.x, bird.y, Math.floor(Math.max(0, elapsedMs) / 300) % 2 === 0 ? "v" : "^", colors.bird)
  }
  // Beacon smoke climbing past the roof.
  for (const puff of greatwallSmoke(elapsedMs)) {
    paint(puff.x, puff.y, "o", colors.smoke)
  }
  // Far ridge with pines behind the wall.
  for (let x = 2; x < GREATWALL_COLUMNS; x += 11) {
    paint(x, 8, "/\\", colors.ridgeFar)
  }
  paint(0, 9, " ".repeat(GREATWALL_COLUMNS), colors.ridgeFar, colors.ridgeFar)
  for (const pine of GREATWALL_PINES) {
    paint(pine, 6, "/\\", colors.pine)
    paint(pine, 7, "||", colors.pine)
  }
  // Distant beacon tower standing on the far ridge.
  const far = GREATWALL_FAR_TOWER
  paint(far.x0, far.top, "/---\\", colors.ridgeFar)
  for (let y = far.top + 1; y <= far.base; y++) {
    paint(far.x0 + 1, y, "|||", colors.ridgeFar)
  }
  // Watchtower straddling the middle ridge, with a rippling flag.
  const tower = GREATWALL_TOWER
  paint(tower.x0 - 1, tower.top, "/________\\", colors.roof)
  for (let y = tower.top + 1; y <= tower.base; y++) {
    paint(tower.x0, y, "|" + " ".repeat(tower.x1 - tower.x0 - 1) + "|", colors.brickDark, colors.brick)
  }
  paint(Math.round((tower.x0 + tower.x1) / 2) - 1, tower.top + 3, "[]", colors.brickDark, colors.brick)
  paint(GREATWALL_FLAG_X, 1, "|", colors.brickDark)
  paint(GREATWALL_FLAG_X, 2, "|", colors.brickDark)
  paint(GREATWALL_FLAG_X, 3, "|", colors.brickDark)
  const ripple = flag === 0 ? ">>>" : flag === 1 ? "~~~" : "<<<"
  paint(GREATWALL_FLAG_X + 1, 1, ripple, colors.flag)
  paint(GREATWALL_FLAG_X + 1, 2, ripple, colors.flag)
  // An eagle soars in front of the tower.
  const eagle = greatwallEagle(elapsedMs)
  paint(eagle.x, eagle.y, "V", colors.bird)
  // Crenellated wall with coursed brickwork following the ridge.
  for (let x = 0; x < GREATWALL_COLUMNS; x++) {
    if (x >= tower.x0 && x <= tower.x1) continue
    const y = greatwallRidgeY(x)
    paint(x, y, x % 2 === 0 ? "#" : " ", x % 2 === 0 ? colors.brickDark : colors.sky, colors.brick)
    paint(x, y + 1, x % 2 === 0 ? "|" : ":", x % 2 === 0 ? colors.brickDark : colors.brickLight, colors.brick)
    paint(x, y + 2, "|", colors.brickDark, colors.brick)
  }
  // Braziers ride the wall top.
  const torch = greatwallTorch(elapsedMs)
  for (const brazier of GREATWALL_BRAZIERS) {
    paint(brazier, greatwallRidgeY(brazier) - 1, torch ? "*" : ".", colors.torch)
  }
  for (let y = GREATWALL_GROUND_TOP; y < GREATWALL_ROWS; y++) {
    paint(0, y, " ".repeat(GREATWALL_COLUMNS), colors.ground, colors.ground)
  }
  for (let x = 0; x < GREATWALL_COLUMNS; x += 4) {
    paint(x, GREATWALL_GROUND_TOP - 1, "/\\", colors.ridge)
  }
  // Foreground scrub in front of the slope.
  for (let x = 3; x < GREATWALL_COLUMNS; x += 7) {
    paint(x, GREATWALL_GROUND_TOP + 4, "^^", colors.ridge, colors.ground)
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
