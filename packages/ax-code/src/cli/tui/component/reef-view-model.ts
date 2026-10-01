import type { FujiRun } from "./fuji-view-model"

export type ReefStyle = "reef-day" | "reef-night"
export function isReefStyle(style: string | undefined): style is ReefStyle {
  return style === "reef-day" || style === "reef-night"
}

/** Reference composition size shared by both renderers. */
export const REEF_COLUMNS = 76
export const REEF_ROWS = 24
export const REEF_SAND_TOP = 21
/** Coral heads rooting on the sand. */
export const REEF_CORALS = [8, 24, 40, 54, 66] as const
/** Light rays shimmering down through day water. */
export const REEF_RAYS = [14, 36, 58] as const
/** Kelp fronds swaying at the sand edges. */
export const REEF_KELP = [2, 70] as const
export const REEF_FISH_COUNT = 6
export const REEF_BUBBLE_COUNT = 8
export const REEF_PLANKTON_COUNT = 10
export const REEF_CYCLE_MS = 2400

/** Palette shared by the text and pixel renderers. */
export const REEF_COLORS = {
  "reef-day": {
    sky: "#3a8ab8",
    skyBottom: "#1c5a7a",
    water: "#2a7a9a",
    ray: "#b8e8f2",
    coral: "#ff7a6a",
    coralDark: "#b83a4a",
    polyp: "#ffd8a8",
    kelp: "#3d8a4a",
    fish: "#ffd84a",
    bubble: "#d8f2fc",
    sand: "#e8d8a8",
    shell: "#ff9a7a",
    plankton: "#b8f2e8",
  },
  "reef-night": {
    sky: "#0e1e3a",
    skyBottom: "#060d1e",
    water: "#14284a",
    ray: "#3a5a8a",
    coral: "#7a4ae8",
    coralDark: "#4a2a9a",
    polyp: "#7af2e8",
    kelp: "#1e4a34",
    fish: "#8a7a4a",
    bubble: "#8ab8d8",
    sand: "#4a4232",
    shell: "#c87a5a",
    plankton: "#6af2c8",
  },
} as const satisfies Record<ReefStyle, Record<string, string>>

export function reefBackground(style: ReefStyle) {
  return style === "reef-day" ? "#4a9ac8" : "#101f3c"
}

/** Sample the vertical water gradient. `t` is 0 at the top of the frame. */
export function reefSkyRgb(style: ReefStyle, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(reefBackground(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(REEF_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

export type ReefFish = { x: number; y: number }
/** A school sweeping left to right on the shared 2400ms cycle. */
export function reefFish(elapsedMs: number): ReefFish[] {
  const phase = (Math.max(0, elapsedMs) % REEF_CYCLE_MS) / REEF_CYCLE_MS
  const head = Math.floor(phase * (REEF_COLUMNS + 12)) - 6
  return Array.from({ length: REEF_FISH_COUNT }, (_, i) => ({
    x: head - i * 4,
    y: 8 + (i % 3) * 2,
  }))
}

export type ReefBubble = { x: number; y: number }
/** Bubbles rising from the reef, looping with the cycle. */
export function reefBubbles(elapsedMs: number): ReefBubble[] {
  const phase = (Math.max(0, elapsedMs) % REEF_CYCLE_MS) / REEF_CYCLE_MS
  return Array.from({ length: REEF_BUBBLE_COUNT }, (_, i) => {
    const y = 19 - ((((i * 13 + 5) % 17) + phase * (12 + (i % 3) * 3)) % 17)
    const sway = Math.sin(2 * Math.PI * (phase + i / REEF_BUBBLE_COUNT))
    const x = ((i * 23 + 9) % REEF_COLUMNS) + sway
    return {
      x: Math.max(0, Math.min(REEF_COLUMNS - 1, Math.floor(x))),
      y: Math.floor(y),
    }
  })
}

export type ReefPlankton = { x: number; y: number }
/** Plankton motes drifting through the night water. */
export function reefPlankton(elapsedMs: number): ReefPlankton[] {
  const phase = (Math.max(0, elapsedMs) % REEF_CYCLE_MS) / REEF_CYCLE_MS
  return Array.from({ length: REEF_PLANKTON_COUNT }, (_, i) => {
    const x = (((i * 17 + 5) % REEF_COLUMNS) + phase * 24) % REEF_COLUMNS
    const wobble = Math.round(Math.sin(2 * Math.PI * (phase + i / REEF_PLANKTON_COUNT)))
    const y = 4 + ((i * 7 + 2) % 13) + wobble
    return {
      x: Math.floor(x),
      y: Math.max(1, Math.min(REEF_SAND_TOP - 1, y)),
    }
  })
}

/** Kelp-tip sway in cells, shared by both renderers. */
export function reefSway(elapsedMs: number, kelpX: number): number {
  const phase = (Math.max(0, elapsedMs) % REEF_CYCLE_MS) / REEF_CYCLE_MS
  return Math.round(Math.sin(2 * Math.PI * (phase + kelpX / REEF_COLUMNS)) * 2)
}

/** Surface ripple offset shared by both renderers. */
export function reefRipple(elapsedMs: number): number {
  const phase = (Math.max(0, elapsedMs) % REEF_CYCLE_MS) / REEF_CYCLE_MS
  return Math.floor(phase * 12) % 3
}

export function reefRows(columns: number, rows: number, style: ReefStyle, elapsedMs: number): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const night = style === "reef-night"
  const colors = REEF_COLORS[style]
  const grid: FujiRun[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: colors.sky })),
  )
  const left = Math.floor((width - REEF_COLUMNS) / 2),
    top = Math.floor((height - REEF_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + Math.round(y)
    if (row < 0 || row >= height) return
    for (let i = 0; i < text.length; i++) {
      const sceneX = Math.round(x) + i
      const column = left + sceneX
      if (sceneX < 0 || sceneX >= REEF_COLUMNS || column < 0 || column >= width) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }
  for (let y = 0; y < REEF_SAND_TOP; y++) {
    paint(0, y, " ".repeat(REEF_COLUMNS), colors.water, colors.water)
  }
  for (let x = reefRipple(elapsedMs); x < REEF_COLUMNS; x += 3) {
    paint(x, 0, "~", colors.bubble, colors.water)
  }
  if (!night) {
    for (const ray of REEF_RAYS) {
      for (let y = 1; y <= 14; y++) {
        paint(ray + Math.floor(y / 4), y, "/", colors.ray, colors.water)
      }
    }
  }
  for (const bubble of reefBubbles(elapsedMs)) {
    const row = top + bubble.y
    if (row < 0 || row >= height) continue
    const column = left + bubble.x
    if (bubble.x < 0 || bubble.x >= REEF_COLUMNS || column < 0 || column >= width) continue
    const cell = grid[row]![column]!
    grid[row]![column] = { text: "o", color: colors.bubble, background: cell.background }
  }
  if (night) {
    for (const mote of reefPlankton(elapsedMs)) {
      const row = top + mote.y
      if (row < 0 || row >= height) continue
      const column = left + mote.x
      if (mote.x < 0 || mote.x >= REEF_COLUMNS || column < 0 || column >= width) continue
      const cell = grid[row]![column]!
      grid[row]![column] = { text: ".", color: colors.plankton, background: cell.background }
    }
  }
  for (const coral of REEF_CORALS) {
    paint(coral, 17, "Y", colors.coral, colors.water)
    paint(coral, 18, "|", colors.coral, colors.water)
    paint(coral - 2, 18, "*", colors.polyp, colors.water)
    paint(coral + 2, 18, "*", colors.polyp, colors.water)
    paint(coral - 1, 19, "\\|/", colors.coral, colors.water)
    paint(coral - 1, 20, "|||", colors.coralDark, colors.water)
  }
  for (const kelp of REEF_KELP) {
    for (let y = 17; y <= 19; y++) {
      paint(kelp, y, "|", colors.kelp, colors.water)
    }
    paint(kelp + reefSway(elapsedMs, kelp), 16, "o", colors.kelp, colors.water)
  }
  if (!night) {
    for (const fish of reefFish(elapsedMs)) {
      paint(fish.x, fish.y, "><>", colors.fish, colors.water)
    }
  }
  for (let y = REEF_SAND_TOP; y < REEF_ROWS; y++) {
    paint(0, y, " ".repeat(REEF_COLUMNS), colors.sand, colors.sand)
  }
  for (const shell of [12, 34, 58]) {
    paint(shell, REEF_SAND_TOP, "o", colors.shell, colors.sand)
  }
  paint(46, REEF_SAND_TOP + 1, "*", colors.shell, colors.sand)
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
