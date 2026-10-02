import type { FujiRun } from "./fuji-view-model"

export type EiffelStyle = "eiffel-day" | "eiffel-night"
export function isEiffelStyle(style: string | undefined): style is EiffelStyle {
  return style === "eiffel-day" || style === "eiffel-night"
}

/** Reference composition size shared by both renderers. */
export const EIFFEL_COLUMNS = 76
export const EIFFEL_ROWS = 24
export const EIFFEL_CX = 38
export const EIFFEL_TOP = 1
export const EIFFEL_BASE = 19
export const EIFFEL_PLATFORMS = [8, 14] as const
export const EIFFEL_GROUND_TOP = 20
export const EIFFEL_MOON = { x: 12, y: 2 } as const
export const EIFFEL_LAMPS = [14, 62] as const
export const EIFFEL_ARCH_HALF = 12
export const EIFFEL_PIGEON_COUNT = 5
/** Haussmann rooftop chimneys behind the legs. */
export const EIFFEL_ROOFS = [4, 12, 60, 68] as const
export const EIFFEL_CAROUSEL = { x: 8, top: 20, base: 22 } as const
export const EIFFEL_FOUNTAIN = { x: 49, top: 20, base: 22 } as const
/** Sparkle anchors on the lattice, shared by both renderers. */
export const EIFFEL_SPARKLES = [
  { x: 38, y: 1 },
  { x: 34, y: 6 },
  { x: 42, y: 6 },
  { x: 31, y: 11 },
  { x: 45, y: 11 },
  { x: 28, y: 16 },
  { x: 48, y: 16 },
  { x: 38, y: 9 },
] as const
/** Night stars in row-major order, shared by both renderers. */
export const EIFFEL_STARS = [
  { x: 4, y: 0 },
  { x: 20, y: 1 },
  { x: 56, y: 0 },
  { x: 66, y: 2 },
  { x: 72, y: 1 },
] as const

/** Palette shared by the text and pixel renderers. */
export const EIFFEL_COLORS = {
  "eiffel-day": {
    sky: "#7ab5d3",
    skyBottom: "#e2f0e4",
    iron: "#6a5a4e",
    ironDark: "#42382f",
    arch: "#54483c",
    sparkle: "#fff3c8",
    beacon: "#ff5252",
    lawn: "#4a7a3d",
    path: "#c8bd9a",
    lampGlow: "#fff3c8",
    ground: "#5a7a4a",
    cloud: "#f2f8fc",
    roof: "#8a7a68",
    carousel: "#c33d4e",
    fountain: "#4a9ac3",
  },
  "eiffel-night": {
    sky: "#8ba0c8",
    skyBottom: "#1c2a55",
    iron: "#3d3832",
    ironDark: "#221f1b",
    arch: "#2a2620",
    sparkle: "#ffe14e",
    beacon: "#ff5252",
    lawn: "#16240f",
    path: "#4a463c",
    lampGlow: "#ffd166",
    ground: "#1a2a1a",
    cloud: "#2c3a5e",
    roof: "#2c2a34",
    carousel: "#7a2a3a",
    fountain: "#2a6a9a",
  },
} as const satisfies Record<EiffelStyle, Record<string, string>>

export function eiffelBackground(style: EiffelStyle) {
  return style === "eiffel-day" ? "#8ec8e8" : "#0a1030"
}

/** Sample the vertical sky gradient. `t` is 0 at the top of the frame. */
export function eiffelSkyRgb(style: EiffelStyle, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(eiffelBackground(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(EIFFEL_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

/** Lattice half-width at scene row `y`: a slim spire flaring into the legs. */
export function eiffelHalf(y: number): number {
  const u = Math.max(0, Math.min(1, (y - EIFFEL_TOP) / (EIFFEL_BASE - EIFFEL_TOP)))
  return 1 + Math.pow(u, 1.55) * 10
}

/** Sparkle `i` flashes on a shared 1200ms round. */
export function eiffelFlash(elapsedMs: number, i: number): boolean {
  return (Math.floor(Math.max(0, elapsedMs) / 150) + i) % 8 === 0
}

/** Summit beacon glows on a 1200ms beat, bright at rest. */
export function eiffelBeacon(elapsedMs: number): boolean {
  return Math.floor(Math.max(0, elapsedMs) / 600) % 2 === 0
}

/** Searchlight side -1 | 1 sweeping on a 1200ms round. */
export function eiffelBeam(elapsedMs: number): -1 | 1 {
  return Math.floor(Math.max(0, elapsedMs) / 600) % 2 === 0 ? -1 : 1
}

export type EiffelPigeon = { x: number; y: number }
/** Pigeons crossing above the Champ de Mars. */
export function eiffelPigeons(elapsedMs: number): EiffelPigeon[] {
  const step = Math.floor(Math.max(0, elapsedMs) / 260) * 2
  return Array.from({ length: EIFFEL_PIGEON_COUNT }, (_, i) => ({
    x: (i * 17 + 8 + step) % (EIFFEL_COLUMNS + 8),
    y: 4 + (i % 3),
  }))
}

export function eiffelRows(columns: number, rows: number, style: EiffelStyle, elapsedMs: number): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const night = style === "eiffel-night"
  const colors = EIFFEL_COLORS[style]
  const beam = eiffelBeam(elapsedMs)
  const grid: FujiRun[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: colors.sky })),
  )
  const left = Math.floor((width - EIFFEL_COLUMNS) / 2),
    top = Math.floor((height - EIFFEL_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + Math.round(y)
    if (row < 0 || row >= height) return
    for (let i = 0; i < text.length; i++) {
      const sceneX = Math.round(x) + i
      const column = left + sceneX
      if (sceneX < 0 || sceneX >= EIFFEL_COLUMNS || column < 0 || column >= width) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }
  if (night) {
    EIFFEL_STARS.forEach((star, i) => {
      paint(star.x, star.y, eiffelFlash(elapsedMs, i) ? "*" : ".", colors.sky)
    })
    paint(EIFFEL_MOON.x - 1, EIFFEL_MOON.y - 1, ".-.", colors.sparkle)
    paint(EIFFEL_MOON.x - 2, EIFFEL_MOON.y, "(   )", colors.sparkle)
  }
  // Pigeons crossing above the Champ de Mars.
  const flap = Math.floor(Math.max(0, elapsedMs) / 300) % 2 === 0
  for (const pigeon of eiffelPigeons(elapsedMs)) {
    paint(pigeon.x, pigeon.y, flap ? "v" : "^", colors.ironDark)
  }
  // Sweeping searchlight fanning from the summit.
  for (let i = 1; i <= 3; i++) {
    paint(EIFFEL_CX + beam * i * 3, 1 + i, i === 3 ? "*" : ".", colors.sparkle)
  }
  for (let y = EIFFEL_TOP; y <= EIFFEL_BASE; y++) {
    const half = Math.round(eiffelHalf(y))
    const x0 = EIFFEL_CX - half
    const x1 = EIFFEL_CX + half
    paint(x0, y, "/", colors.ironDark)
    paint(x1, y, "\\", colors.ironDark)
    for (let x = x0 + 2; x <= x1 - 2; x += 4) {
      paint(x, y, "x", colors.iron)
    }
  }
  // Grand arch grounding the legs.
  for (let dx = -EIFFEL_ARCH_HALF; dx <= EIFFEL_ARCH_HALF; dx++) {
    const y = EIFFEL_BASE - Math.round(Math.sqrt(EIFFEL_ARCH_HALF * EIFFEL_ARCH_HALF - dx * dx) / 3)
    paint(EIFFEL_CX + dx, y, "#", colors.arch)
  }
  for (const platform of EIFFEL_PLATFORMS) {
    const half = Math.round(eiffelHalf(platform)) + 1
    paint(EIFFEL_CX - half, platform, "=".repeat(half * 2 + 1), colors.ironDark)
  }
  EIFFEL_SPARKLES.forEach((spark, i) => {
    if (eiffelFlash(elapsedMs, i)) paint(spark.x, spark.y, "*", colors.sparkle)
    else if (night) paint(spark.x, spark.y, ".", colors.iron)
  })
  paint(EIFFEL_CX, EIFFEL_TOP, eiffelBeacon(elapsedMs) ? "*" : ".", colors.beacon)
  // Champ de Mars with paths, flower dots, and lamps.
  for (let y = EIFFEL_GROUND_TOP; y < EIFFEL_ROWS; y++) {
    paint(0, y, " ".repeat(EIFFEL_COLUMNS), colors.lawn, colors.lawn)
  }
  for (let y = EIFFEL_GROUND_TOP; y < EIFFEL_ROWS; y++) {
    paint(37, y, "|||", colors.path, colors.lawn)
  }
  paint(20, 22, "=".repeat(37), colors.path, colors.lawn)
  for (let x = 2; x < EIFFEL_COLUMNS; x++) {
    if ((x * 5 + 21 * 2) % 11 === 0) paint(x, 21, "*", colors.sparkle, colors.lawn)
    if ((x * 5 + 23 * 2) % 11 === 0) paint(x, 23, "*", colors.sparkle, colors.lawn)
  }
  for (const lamp of EIFFEL_LAMPS) {
    paint(lamp, 17, night ? "*" : ".", colors.lampGlow)
    paint(lamp, 18, "|", colors.ironDark)
    paint(lamp, 19, "|", colors.ironDark)
  }
  // Haussmann rooftops behind the legs.
  for (const roof of EIFFEL_ROOFS) {
    paint(roof, 16, "/\\", colors.roof)
    paint(roof, 17, "||", colors.roof)
    paint(roof, 18, "||", colors.roof)
  }
  // Carousel spinning on the lawn.
  const ride = EIFFEL_CAROUSEL
  paint(ride.x, ride.top, "/\\/\\", colors.carousel, colors.lawn)
  paint(ride.x + 1, ride.top + 1, "||", colors.ironDark, colors.lawn)
  paint(ride.x, ride.base, "====", colors.carousel, colors.lawn)
  // Fountain jetting beside the path.
  const jet = EIFFEL_FOUNTAIN
  paint(jet.x, jet.top, "o", colors.fountain, colors.lawn)
  paint(jet.x - 1, jet.top + 1, "~", colors.fountain, colors.lawn)
  paint(jet.x + 1, jet.top + 1, "~", colors.fountain, colors.lawn)
  paint(jet.x - 1, jet.base, "[==]", colors.ironDark, colors.lawn)
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
