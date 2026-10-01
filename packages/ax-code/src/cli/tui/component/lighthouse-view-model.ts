import type { FujiRun } from "./fuji-view-model"

export type LighthouseStyle = "lighthouse-day" | "lighthouse-night"
export function isLighthouseStyle(style: string | undefined): style is LighthouseStyle {
  return style === "lighthouse-day" || style === "lighthouse-night"
}

/** Reference composition size shared by both renderers. */
export const LIGHTHOUSE_COLUMNS = 76
export const LIGHTHOUSE_ROWS = 24
export const LIGHTHOUSE_TOWER = { x: 12, top: 5, base: 15 } as const
export const LIGHTHOUSE_LAMP = { x: 12, y: 4 } as const
export const LIGHTHOUSE_CLIFF_TOP = 16
export const LIGHTHOUSE_SEA_TOP = 18
export const LIGHTHOUSE_GULL_COUNT = 4
export const LIGHTHOUSE_MOON = { x: 60, y: 2 } as const
/** Night stars in row-major order, shared by both renderers. */
export const LIGHTHOUSE_STARS = [
  { x: 30, y: 1 },
  { x: 40, y: 3 },
  { x: 50, y: 0 },
  { x: 66, y: 4 },
  { x: 72, y: 1 },
  { x: 22, y: 5 },
] as const
export const LIGHTHOUSE_CYCLE_MS = 2400

/** Palette shared by the text and pixel renderers. */
export const LIGHTHOUSE_COLORS = {
  "lighthouse-day": {
    sky: "#7ab5d3",
    skyBottom: "#e4f2da",
    tower: "#f2f0e8",
    stripe: "#c33d1e",
    lamp: "#4a4a5e",
    glass: "#9ad0e8",
    cliff: "#8a7a68",
    cliffDark: "#5a4e40",
    sea: "#3a7ab8",
    seaDeep: "#1e4a78",
    foam: "#f2f8fc",
    gull: "#3a3a4e",
    cloud: "#f2f8fc",
  },
  "lighthouse-night": {
    sky: "#8ba0c8",
    skyBottom: "#1c2a55",
    tower: "#8a8a9a",
    stripe: "#6a2012",
    lamp: "#2c2c3e",
    glass: "#ffdf6b",
    cliff: "#3a342c",
    cliffDark: "#242020",
    sea: "#1e3a5e",
    seaDeep: "#0e1e3a",
    foam: "#8ab8d8",
    gull: "#8a8a9e",
    cloud: "#2c3a5e",
  },
} as const satisfies Record<LighthouseStyle, Record<string, string>>

export function lighthouseBackground(style: LighthouseStyle) {
  return style === "lighthouse-day" ? "#8ec8e8" : "#0a1030"
}

/** Sample the vertical sky gradient. `t` is 0 at the top of the frame. */
export function lighthouseSkyRgb(style: LighthouseStyle, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(lighthouseBackground(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(LIGHTHOUSE_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

export type LighthouseGull = { x: number; y: number }
/** Gulls glide left across the sky, looping with the cycle. */
export function lighthouseGulls(elapsedMs: number): LighthouseGull[] {
  const phase = (Math.max(0, elapsedMs) % LIGHTHOUSE_CYCLE_MS) / LIGHTHOUSE_CYCLE_MS
  return Array.from({ length: LIGHTHOUSE_GULL_COUNT }, (_, i) => {
    const drifted = ((i * 29 + 11) % LIGHTHOUSE_COLUMNS) - phase * (LIGHTHOUSE_COLUMNS + 8)
    const x = ((drifted % LIGHTHOUSE_COLUMNS) + LIGHTHOUSE_COLUMNS) % LIGHTHOUSE_COLUMNS
    const flap = Math.sin(2 * Math.PI * (phase * 2 + i / LIGHTHOUSE_GULL_COUNT))
    return { x: Math.floor(x), y: 2 + ((i * 5 + 1) % 5) + Math.round(flap) }
  })
}

/** Beam quarter: 0 east, 1 south, 2 west, 3 north. Rotates once per cycle. */
export function lighthouseBeam(elapsedMs: number): number {
  const phase = (Math.max(0, elapsedMs) % LIGHTHOUSE_CYCLE_MS) / LIGHTHOUSE_CYCLE_MS
  return Math.floor(phase * 4) % 4
}

/** Wave crest offset. Surf rolls toward the cliffs each cycle. */
export function lighthouseSurf(elapsedMs: number): number {
  const phase = (Math.max(0, elapsedMs) % LIGHTHOUSE_CYCLE_MS) / LIGHTHOUSE_CYCLE_MS
  return Math.floor(phase * 12)
}

export function lighthouseRows(
  columns: number,
  rows: number,
  style: LighthouseStyle,
  elapsedMs: number,
): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const night = style === "lighthouse-night"
  const colors = LIGHTHOUSE_COLORS[style]
  const beam = lighthouseBeam(elapsedMs)
  const surf = lighthouseSurf(elapsedMs)
  const grid: FujiRun[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: colors.sky })),
  )
  const left = Math.floor((width - LIGHTHOUSE_COLUMNS) / 2),
    top = Math.floor((height - LIGHTHOUSE_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + Math.round(y)
    if (row < 0 || row >= height) return
    for (let i = 0; i < text.length; i++) {
      const sceneX = Math.round(x) + i
      const column = left + sceneX
      if (sceneX < 0 || sceneX >= LIGHTHOUSE_COLUMNS || column < 0 || column >= width) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }
  if (night) {
    LIGHTHOUSE_STARS.forEach((star, i) => {
      paint(star.x, star.y, (Math.floor(Math.max(0, elapsedMs) / 400) + i) % 3 === 0 ? "*" : ".", colors.sky)
    })
    paint(LIGHTHOUSE_MOON.x - 1, LIGHTHOUSE_MOON.y - 1, ".-.", colors.cloud)
    paint(LIGHTHOUSE_MOON.x - 2, LIGHTHOUSE_MOON.y, "(   )", colors.cloud)
  } else {
    // Slow clouds drifting with the gull phase.
    for (let x = 4; x < LIGHTHOUSE_COLUMNS; x += 25) {
      paint((x + surf * 2) % LIGHTHOUSE_COLUMNS, 1 + (x % 3), "~~~", colors.cloud)
    }
  }
  // Gulls ride the sea wind in both skies.
  for (const gull of lighthouseGulls(elapsedMs)) {
    const wing = Math.floor(Math.max(0, elapsedMs) / 300 + gull.x) % 2 === 0 ? "v" : "^"
    paint(gull.x, gull.y, wing, colors.gull)
  }
  const tower = LIGHTHOUSE_TOWER
  // Striped tower on the cliff head.
  for (let y = tower.top; y <= tower.base; y++) {
    const band = Math.floor((y - tower.top) / 2) % 2 === 1
    paint(tower.x - 1, y, "||||", band ? colors.stripe : colors.tower, band ? colors.stripe : colors.tower)
  }
  paint(tower.x - 2, tower.base + 1, "======", colors.cliffDark)
  // Gallery and lantern room, lit at night.
  paint(tower.x - 2, LIGHTHOUSE_LAMP.y, "+====+", colors.lamp)
  paint(
    tower.x - 1,
    LIGHTHOUSE_LAMP.y - 1,
    night ? "[**]" : "[  ]",
    night ? colors.glass : colors.lamp,
    night ? colors.glass : colors.tower,
  )
  paint(tower.x, LIGHTHOUSE_LAMP.y - 2, "/\\", colors.lamp)
  // Rotating beam sweeping from the lamp.
  if (night) {
    const lampX = tower.x + 1,
      lampY = LIGHTHOUSE_LAMP.y - 1
    if (beam === 0) paint(lampX + 1, lampY, "=".repeat(20), colors.glass)
    else if (beam === 1) for (let i = 1; i <= 9; i++) paint(lampX + i, lampY + Math.floor(i / 2), "\\", colors.glass)
    else if (beam === 2) paint(lampX - 21, lampY, "=".repeat(20), colors.glass)
    else for (let i = 1; i <= 6; i++) paint(lampX + i, lampY - Math.floor(i / 2), "/", colors.glass)
  }
  // Rocky cliffs falling to the surf.
  for (let y = LIGHTHOUSE_CLIFF_TOP; y < LIGHTHOUSE_SEA_TOP; y++) {
    paint(0, y, " ".repeat(24), colors.cliff, colors.cliff)
    paint(4 + ((y * 7) % 12), y, "###", colors.cliffDark, colors.cliff)
  }
  paint(0, LIGHTHOUSE_CLIFF_TOP - 1, "_".repeat(24), colors.cliff)
  // Rolling waves with foam crests marching shoreward.
  for (let y = LIGHTHOUSE_SEA_TOP; y < LIGHTHOUSE_ROWS; y++) {
    paint(0, y, " ".repeat(LIGHTHOUSE_COLUMNS), colors.sea, y % 2 === 0 ? colors.sea : colors.seaDeep)
  }
  for (let x = 0; x < LIGHTHOUSE_COLUMNS; x += 6) {
    const crest = (((x + surf) % LIGHTHOUSE_COLUMNS) + LIGHTHOUSE_COLUMNS) % LIGHTHOUSE_COLUMNS
    paint(crest, LIGHTHOUSE_SEA_TOP + 1, "~~", colors.foam, colors.seaDeep)
    paint(crest + 3, LIGHTHOUSE_SEA_TOP + 3, "~~", colors.foam, colors.seaDeep)
  }
  // Moonlit path glittering under the moon at night.
  if (night) {
    for (let y = LIGHTHOUSE_SEA_TOP; y < LIGHTHOUSE_ROWS; y++) {
      paint(LIGHTHOUSE_MOON.x, y, "|", colors.foam, y % 2 === 0 ? colors.sea : colors.seaDeep)
    }
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
