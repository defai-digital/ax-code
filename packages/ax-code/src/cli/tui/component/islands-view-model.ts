import type { FujiRun } from "./fuji-view-model"

export type IslandsStyle = "islands-day" | "islands-dusk"
export function isIslandsStyle(style: string | undefined): style is IslandsStyle {
  return style === "islands-day" || style === "islands-dusk"
}

/** Reference composition size shared by both renderers. */
export const ISLANDS_COLUMNS = 76
export const ISLANDS_ROWS = 24
export const ISLANDS_SEA_TOP = 20
/** Floating islands as [x0, x1, top] in scene cells. */
export const ISLANDS = [
  [26, 49, 10],
  [6, 17, 7],
  [58, 71, 8],
] as const
/** Waterfall columns as [x, top] pouring off island edges. */
export const ISLANDS_FALLS = [
  [7, 8],
  [16, 8],
  [27, 11],
  [48, 11],
  [59, 9],
  [70, 9],
] as const
/** Drifting clouds as [x, y] anchors. */
export const ISLANDS_CLOUDS = [
  [12, 2],
  [50, 3],
] as const
export const ISLANDS_SUN = { x: 64, y: 2 } as const
export const ISLANDS_DUSK_SUN = { x: 34, y: 15 } as const
export const ISLANDS_BIRD_COUNT = 4
export const ISLANDS_FIREFLY_COUNT = 8
export const ISLANDS_CYCLE_MS = 2400

/** Palette shared by the text and pixel renderers. */
export const ISLANDS_COLORS = {
  "islands-day": {
    sky: "#7ab5d3",
    skyBottom: "#d8ecf2",
    sun: "#ffe9a8",
    cloud: "#f2f8fc",
    grass: "#4a8a4a",
    rock: "#8a7a68",
    rockDark: "#5a4a3c",
    falls: "#7ac8e8",
    sea: "#2a6a8a",
    seaDeep: "#1c4a62",
    shimmer: "#b8e8f2",
    bird: "#2c3a4a",
    firefly: "#ffe98a",
  },
  "islands-dusk": {
    sky: "#e88a4a",
    skyBottom: "#7a3a5a",
    sun: "#ffb85e",
    cloud: "#c8788a",
    grass: "#2c4a34",
    rock: "#4a3a34",
    rockDark: "#2c2220",
    falls: "#8a7ab8",
    sea: "#3a2a5e",
    seaDeep: "#241a3e",
    shimmer: "#e89a6a",
    bird: "#1c1a24",
    firefly: "#ffdf5e",
  },
} as const satisfies Record<IslandsStyle, Record<string, string>>

export function islandsBackground(style: IslandsStyle) {
  return style === "islands-day" ? "#8ec8e8" : "#c86a4a"
}

/** Sample the vertical sky gradient. `t` is 0 at the top of the frame. */
export function islandsSkyRgb(style: IslandsStyle, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(islandsBackground(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(ISLANDS_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

export type IslandsBird = { x: number; y: number }
/** Birds circling the main island on the shared 2400ms cycle. */
export function islandsBirds(elapsedMs: number): IslandsBird[] {
  const phase = (Math.max(0, elapsedMs) % ISLANDS_CYCLE_MS) / ISLANDS_CYCLE_MS
  return Array.from({ length: ISLANDS_BIRD_COUNT }, (_, i) => {
    const angle = 2 * Math.PI * (phase + i / ISLANDS_BIRD_COUNT)
    const x = 38 + Math.cos(angle) * 16
    const y = 5 + Math.sin(angle) * 3
    return {
      x: Math.max(0, Math.min(ISLANDS_COLUMNS - 1, Math.floor(x))),
      y: Math.max(0, Math.min(ISLANDS_ROWS - 1, Math.floor(y))),
    }
  })
}

export type IslandsFirefly = { x: number; y: number; char: string }
/** Fireflies rising past the silhouetted islands, blinking on a 300ms beat. */
export function islandsFireflies(elapsedMs: number): IslandsFirefly[] {
  const safe = Math.max(0, elapsedMs)
  const phase = (safe % ISLANDS_CYCLE_MS) / ISLANDS_CYCLE_MS
  return Array.from({ length: ISLANDS_FIREFLY_COUNT }, (_, i) => {
    const y = 19 - ((((i * 11 + 3) % 14) + phase * (10 + (i % 3) * 3)) % 14)
    const sway = Math.sin(2 * Math.PI * (phase + i / ISLANDS_FIREFLY_COUNT)) * 2
    const x = ((i * 29 + 7) % ISLANDS_COLUMNS) + sway
    return {
      x: Math.max(0, Math.min(ISLANDS_COLUMNS - 1, Math.floor(x))),
      y: Math.floor(y),
      char: (Math.floor(safe / 300) + i) % 2 === 0 ? "*" : ".",
    }
  })
}

/** Waterfall flow step shared by both renderers. */
export function islandsFlow(elapsedMs: number): number {
  const phase = (Math.max(0, elapsedMs) % ISLANDS_CYCLE_MS) / ISLANDS_CYCLE_MS
  return Math.floor(phase * 8) % 4
}

export function islandsRows(columns: number, rows: number, style: IslandsStyle, elapsedMs: number): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const night = style === "islands-dusk"
  const colors = ISLANDS_COLORS[style]
  const flow = islandsFlow(elapsedMs)
  const grid: FujiRun[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: colors.sky })),
  )
  const left = Math.floor((width - ISLANDS_COLUMNS) / 2),
    top = Math.floor((height - ISLANDS_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + Math.round(y)
    if (row < 0 || row >= height) return
    for (let i = 0; i < text.length; i++) {
      const sceneX = Math.round(x) + i
      const column = left + sceneX
      if (sceneX < 0 || sceneX >= ISLANDS_COLUMNS || column < 0 || column >= width) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }
  if (night) {
    const sun = ISLANDS_DUSK_SUN
    paint(sun.x - 2, sun.y - 1, ".-.", colors.sun)
    paint(sun.x - 2, sun.y, "(   )", colors.sun)
    paint(sun.x - 2, sun.y + 1, "'-'", colors.sun)
  } else {
    paint(ISLANDS_SUN.x - 1, ISLANDS_SUN.y - 1, ".-.", colors.sun)
    paint(ISLANDS_SUN.x - 2, ISLANDS_SUN.y, "(   )", colors.sun)
  }
  for (const [cx, cy] of ISLANDS_CLOUDS) {
    paint(cx, cy, "__", colors.cloud)
    paint(cx - 1, cy + 1, "(____)", colors.cloud)
  }
  for (const [fallX, fallTop] of ISLANDS_FALLS) {
    for (let y = fallTop; y < ISLANDS_SEA_TOP; y++) {
      paint(fallX, y, (y + flow) % 2 === 0 ? "|" : ":", colors.falls)
    }
  }
  for (const [x0, x1, islandTop] of ISLANDS) {
    paint(x0, islandTop, "_".repeat(x1 - x0 + 1), colors.grass)
    for (let d = 1; d <= 4; d++) {
      const inset = Math.min(d, Math.floor((x1 - x0) / 2))
      const rowWidth = x1 - x0 + 1 - inset * 2
      paint(x0 + inset, islandTop + d, " ".repeat(Math.max(1, rowWidth)), colors.rock, colors.rock)
    }
    const tip = Math.floor((x0 + x1) / 2)
    paint(tip, islandTop + 5, "V", colors.rockDark)
  }
  if (night) {
    for (const mote of islandsFireflies(elapsedMs)) {
      const row = top + mote.y
      if (row < 0 || row >= height) continue
      const column = left + mote.x
      if (mote.x < 0 || mote.x >= ISLANDS_COLUMNS || column < 0 || column >= width) continue
      const cell = grid[row]![column]!
      grid[row]![column] = { text: mote.char, color: colors.firefly, background: cell.background }
    }
  } else {
    for (const bird of islandsBirds(elapsedMs)) {
      const row = top + bird.y
      if (row < 0 || row >= height) continue
      const column = left + bird.x
      if (bird.x < 0 || bird.x >= ISLANDS_COLUMNS || column < 0 || column >= width) continue
      const cell = grid[row]![column]!
      grid[row]![column] = { text: "v", color: colors.bird, background: cell.background }
    }
  }
  for (let y = ISLANDS_SEA_TOP; y < ISLANDS_ROWS; y++) {
    paint(0, y, " ".repeat(ISLANDS_COLUMNS), colors.sea, y >= ISLANDS_SEA_TOP + 2 ? colors.seaDeep : colors.sea)
  }
  for (let x = flow; x < ISLANDS_COLUMNS; x += 8) {
    paint(x, ISLANDS_SEA_TOP, "~", colors.shimmer, colors.sea)
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
