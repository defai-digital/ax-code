import type { FujiRun } from "./fuji-view-model"

export type VolcanoStyle = "volcano-eruption" | "volcano-calm"
export function isVolcanoStyle(style: string | undefined): style is VolcanoStyle {
  return style === "volcano-eruption" || style === "volcano-calm"
}

/** Reference composition size shared by both renderers. */
export const VOLCANO_COLUMNS = 76
export const VOLCANO_ROWS = 24
export const VOLCANO_CX = 38
export const VOLCANO_TOP = 8
export const VOLCANO_BASE = 18
export const VOLCANO_CRATER = { x0: 34, x1: 42, y0: 8, y1: 9 } as const
export const VOLCANO_LAVA_X = 44
export const VOLCANO_GROUND_TOP = 19
export const VOLCANO_MOON = { x: 14, y: 2 } as const
/** Calm-night stars in row-major order, shared by the text and pixel twinkle phase. */
export const VOLCANO_STARS = [
  { x: 3, y: 0 },
  { x: 8, y: 0 },
  { x: 15, y: 0 },
  { x: 23, y: 0 },
  { x: 29, y: 0 },
  { x: 30, y: 1 },
  { x: 37, y: 1 },
  { x: 44, y: 1 },
] as const

/** Palette shared by the text and pixel renderers. */
export const VOLCANO_COLORS = {
  "volcano-eruption": {
    sky: "#9a7a80",
    skyBottom: "#4a1420",
    rock: "#2a1620",
    rim: "#8a3a2a",
    glowHot: "#ffb14e",
    glowDeep: "#c33d1e",
    lava: "#ff7a2a",
    lavaBright: "#ffd166",
    surge: "#fff0d0",
    ember: "#ff9a3c",
    smoke: "#6a6a7a",
    ground: "#1a0f16",
    pool: "#e04a1a",
  },
  "volcano-calm": {
    sky: "#8ba0c8",
    skyBottom: "#1a2a4a",
    rock: "#1c2333",
    rim: "#3d4a6b",
    glowHot: "#7a2a1e",
    glowDeep: "#4a1a12",
    lava: "#ff7a2a",
    lavaBright: "#ffd166",
    surge: "#fff0d0",
    ember: "#c46a3a",
    smoke: "#6a6a7a",
    ground: "#11182a",
    pool: "#e04a1a",
  },
} as const satisfies Record<VolcanoStyle, Record<string, string>>

export function volcanoBackground(style: VolcanoStyle) {
  return style === "volcano-eruption" ? "#160a14" : "#0a0e24"
}

/** Sample the vertical sky gradient. `t` is 0 at the top of the frame. */
export function volcanoSkyRgb(style: VolcanoStyle, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(volcanoBackground(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(VOLCANO_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

/** Cone half-width at a scene row. */
export function volcanoHalf(y: number): number {
  return 4 + (y - VOLCANO_TOP) * 1.8
}

/** Crater pulse brightness 0..1 on a fixed 1200ms beat. */
export function volcanoGlow(elapsedMs: number): number {
  return 0.5 + 0.5 * Math.sin((2 * Math.PI * Math.max(0, elapsedMs)) / 1200)
}

export type VolcanoEmber = { x: number; y: number; char: string; visible: boolean }
/** Embers rise from the crater and flicker deterministically with elapsed time. */
export function volcanoEmbers(elapsedMs: number): VolcanoEmber[] {
  const t = Math.max(0, elapsedMs)
  return Array.from({ length: 12 }, (_, i) => {
    const speed = 0.004 + (i % 3) * 0.002
    const y = VOLCANO_TOP - ((((i * 53) % 12) + t * speed) % 12)
    return {
      x: 30 + ((i * 37) % 16),
      y,
      char: i % 3 === 0 ? "*" : ".",
      visible: (Math.floor(t / 150) + i) % 3 !== 0,
    }
  })
}

export type VolcanoSmoke = { x: number; y: number; size: number }
/** Gray puffs climbing above the crater, growing as they rise and drifting downwind. */
export function volcanoSmoke(elapsedMs: number): VolcanoSmoke[] {
  const t = Math.max(0, elapsedMs)
  return [0, 1, 2].map((i) => {
    const y = 6 - ((((i * 3 + t * 0.004) % 10) + 10) % 10)
    return { x: 34 + i * 4 + (6 - y) * 0.8, y, size: 1 + (6 - y) * 0.25 }
  })
}

/** Star `i` of VOLCANO_STARS shines bright on a shared 1200ms twinkle round. */
export function volcanoStarBright(elapsedMs: number, i: number): boolean {
  return (Math.floor(Math.max(0, elapsedMs) / 400) + i) % 3 === 0
}

/** White-hot surge rows travelling down the lava channel on a 960ms round. */
export function volcanoSurgeRows(elapsedMs: number): number[] {
  const step = Math.floor(Math.max(0, elapsedMs) / 120)
  return [0, 1, 2].map((k) => 10 + ((step + 1 + k * 3) % 8))
}

/** Lava pool shimmer phase, one column shift per 300ms. */
export function volcanoPoolStep(elapsedMs: number): number {
  return Math.floor(Math.max(0, elapsedMs) / 300) % 3
}

export function volcanoRows(columns: number, rows: number, style: VolcanoStyle, elapsedMs: number): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const eruption = style === "volcano-eruption"
  const colors = VOLCANO_COLORS[style]
  const grid: FujiRun[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: colors.sky })),
  )
  const left = Math.floor((width - VOLCANO_COLUMNS) / 2),
    top = Math.floor((height - VOLCANO_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + Math.round(y)
    if (row < 0 || row >= height) return
    for (let i = 0; i < text.length; i++) {
      const sceneX = Math.round(x) + i
      const column = left + sceneX
      if (sceneX < 0 || sceneX >= VOLCANO_COLUMNS || column < 0 || column >= width) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }
  if (!eruption) {
    VOLCANO_STARS.forEach((star, i) => {
      paint(star.x, star.y, volcanoStarBright(elapsedMs, i) ? "*" : ".", colors.sky)
    })
    paint(VOLCANO_MOON.x - 1, VOLCANO_MOON.y - 1, ".-.", colors.sky)
    paint(VOLCANO_MOON.x - 2, VOLCANO_MOON.y, "(   )", colors.sky)
  }
  for (let y = VOLCANO_TOP; y <= VOLCANO_BASE; y++) {
    const half = volcanoHalf(y)
    const x0 = Math.round(VOLCANO_CX - half)
    const x1 = Math.round(VOLCANO_CX + half)
    paint(x0, y, "/" + " ".repeat(Math.max(0, x1 - x0 - 1)) + "\\", colors.rim, colors.rock)
  }
  const crater = VOLCANO_CRATER
  const craterWidth = crater.x1 - crater.x0 + 1
  if (eruption) {
    paint(crater.x0, crater.y0, "*".repeat(craterWidth), colors.glowHot, colors.glowDeep)
    paint(crater.x0, crater.y1, "+".repeat(craterWidth), colors.glowDeep, colors.rock)
    paint(crater.x0, crater.y0, "^", colors.lavaBright, colors.glowDeep)
    paint(crater.x1, crater.y0, "^", colors.lavaBright, colors.glowDeep)
    const surges = volcanoSurgeRows(elapsedMs)
    for (let y = 10; y <= 17; y++) {
      if (surges.includes(y)) paint(VOLCANO_LAVA_X, y, "**", colors.surge, colors.lava)
      else paint(VOLCANO_LAVA_X, y, "||", colors.lava, colors.rock)
    }
    for (const puff of volcanoSmoke(elapsedMs)) {
      paint(Math.round(puff.x) - 1, Math.round(puff.y), puff.size > 2 ? "O" : "o", colors.smoke)
    }
  } else {
    paint(crater.x0, crater.y0, ".".repeat(craterWidth), colors.glowDeep, colors.rock)
    paint(crater.x0, crater.y1, ".".repeat(craterWidth), colors.glowDeep, colors.rock)
    paint(crater.x0, crater.y0, "^", colors.rim, colors.rock)
    paint(crater.x1, crater.y0, "^", colors.rim, colors.rock)
  }
  for (const ember of volcanoEmbers(elapsedMs)) {
    if (ember.visible) paint(ember.x, ember.y, ember.char, colors.ember)
  }
  for (let y = VOLCANO_GROUND_TOP; y < VOLCANO_ROWS; y++) {
    paint(0, y, " ".repeat(VOLCANO_COLUMNS), colors.ground, colors.ground)
  }
  if (eruption) {
    const step = volcanoPoolStep(elapsedMs)
    for (let x = 40; x <= 48; x++) {
      const crest = (x + step) % 3 === 0
      paint(x, 19, crest ? "~" : "=", crest ? colors.lavaBright : colors.lava, colors.pool)
    }
    paint(40, 20, "~~~~~~~~~", colors.pool, colors.pool)
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
