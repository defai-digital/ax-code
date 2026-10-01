import type { FujiRun } from "./fuji-view-model"

export type ColosseumStyle = "colosseum-day" | "colosseum-night"
export function isColosseumStyle(style: string | undefined): style is ColosseumStyle {
  return style === "colosseum-day" || style === "colosseum-night"
}

/** Reference composition size shared by both renderers. */
export const COLOSSEUM_COLUMNS = 76
export const COLOSSEUM_ROWS = 24
export const COLOSSEUM_WALL = { x0: 12, x1: 63, top: 8, base: 17 } as const
export const COLOSSEUM_GROUND_TOP = 19
export const COLOSSEUM_BIRD_COUNT = 4
export const COLOSSEUM_MOON = { x: 66, y: 2 } as const
/** Cypress trunks flanking the ruin. */
export const COLOSSEUM_CYPRESS = [5, 70] as const
/** Banners hanging between the arches. */
export const COLOSSEUM_BANNERS = [26, 47] as const
/** Statues standing in the crown gaps. */
export const COLOSSEUM_STATUES = [32, 48] as const
/** Umbrella-pine trunks at the far edges. */
export const COLOSSEUM_PINES = [1, 72] as const
/** Gladiators entering through the gate. */
export const COLOSSEUM_GLADIATORS = [33, 43] as const
/** Tourist camera positions along the forecourt. */
export const COLOSSEUM_FLASH = [7, 20, 27, 46, 59, 68] as const
/** Night stars in row-major order, shared by both renderers. */
export const COLOSSEUM_STARS = [
  { x: 3, y: 0 },
  { x: 20, y: 1 },
  { x: 55, y: 0 },
  { x: 72, y: 2 },
] as const

/** Palette shared by the text and pixel renderers. */
export const COLOSSEUM_COLORS = {
  "colosseum-day": {
    sky: "#7ab5d3",
    skyBottom: "#f2e8d0",
    travertine: "#c9bfa0",
    travertineDark: "#7a6e52",
    arch: "#5e5645",
    bird: "#3d3d4a",
    torch: "#e88a3a",
    ground: "#6a7a52",
    cloud: "#f7f3e8",
    cypress: "#3d6a3d",
    banner: "#a83a3a",
    pine: "#3d6a3d",
    crowd: "#5a5a6a",
  },
  "colosseum-night": {
    sky: "#8ba0c8",
    skyBottom: "#232a55",
    travertine: "#5a5648",
    travertineDark: "#34312a",
    arch: "#1e1c18",
    bird: "#c8c8d8",
    torch: "#ffd166",
    ground: "#1c2418",
    cloud: "#2c3a5e",
    cypress: "#1e3a24",
    banner: "#7a2a2a",
    pine: "#1e3a24",
    crowd: "#8a8aa0",
  },
} as const satisfies Record<ColosseumStyle, Record<string, string>>

export function colosseumBackground(style: ColosseumStyle) {
  return style === "colosseum-day" ? "#8ec8e8" : "#0e1433"
}

/** Sample the vertical sky gradient. `t` is 0 at the top of the frame. */
export function colosseumSkyRgb(style: ColosseumStyle, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(colosseumBackground(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(COLOSSEUM_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

/** Gate braziers flicker on a 500ms round, bright at rest. */
export function colosseumTorch(elapsedMs: number): boolean {
  return Math.floor(Math.max(0, elapsedMs) / 250) % 2 === 0
}

/** Tourist cameras take turns flashing on a 2400ms round. */
export function colosseumFlash(elapsedMs: number): number {
  return Math.floor(Math.max(0, elapsedMs) / 400) % COLOSSEUM_FLASH.length
}

export type ColosseumBird = { x: number; y: number }
/** Doves crossing the sky on a 7200ms round. */
export function colosseumBirds(elapsedMs: number): ColosseumBird[] {
  const t = Math.max(0, elapsedMs)
  return Array.from({ length: COLOSSEUM_BIRD_COUNT }, (_, i) => {
    const x = (i * 23 + 4 + Math.floor(t / 300) * 2) % (COLOSSEUM_COLUMNS + 8)
    const y = 2 + i + Math.round(Math.sin((t / 900) * Math.PI * 2 + i) * 1)
    return { x, y }
  })
}

export function colosseumRows(columns: number, rows: number, style: ColosseumStyle, elapsedMs: number): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const night = style === "colosseum-night"
  const colors = COLOSSEUM_COLORS[style]
  const grid: FujiRun[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: colors.sky })),
  )
  const left = Math.floor((width - COLOSSEUM_COLUMNS) / 2),
    top = Math.floor((height - COLOSSEUM_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + Math.round(y)
    if (row < 0 || row >= height) return
    for (let i = 0; i < text.length; i++) {
      const sceneX = Math.round(x) + i
      const column = left + sceneX
      if (sceneX < 0 || sceneX >= COLOSSEUM_COLUMNS || column < 0 || column >= width) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }
  if (night) {
    COLOSSEUM_STARS.forEach((star, i) => {
      paint(star.x, star.y, (Math.floor(Math.max(0, elapsedMs) / 400) + i) % 3 === 0 ? "*" : ".", colors.sky)
    })
    paint(COLOSSEUM_MOON.x - 1, COLOSSEUM_MOON.y - 1, ".-.", colors.torch)
    paint(COLOSSEUM_MOON.x - 2, COLOSSEUM_MOON.y, "(   )", colors.torch)
  } else {
    paint(8, 2, "~~~~", colors.cloud)
    paint(40, 1, "~~~~~~", colors.cloud)
    paint(58, 4, "~~~~~~", colors.cloud)
  }
  for (const bird of colosseumBirds(elapsedMs)) {
    paint(bird.x, bird.y, Math.floor(Math.max(0, elapsedMs) / 300) % 2 === 0 ? "v" : "^", colors.bird)
  }
  // Broken crown over two arcade storeys.
  const wall = COLOSSEUM_WALL
  paint(wall.x0, wall.top - 1, "=".repeat(20) + "  " + "=".repeat(14) + "    " + "=".repeat(10), colors.travertineDark)
  for (let y = wall.top; y <= wall.base; y++) {
    paint(wall.x0, y, "|" + " ".repeat(wall.x1 - wall.x0 - 1) + "|", colors.travertineDark, colors.travertine)
  }
  for (const archY of [10, 14]) {
    for (let x = wall.x0 + 3; x <= wall.x1 - 4; x += 7) {
      paint(x, archY, "nn", colors.arch, night ? colors.torch : colors.travertine)
      paint(x, archY + 1, "||", colors.arch, night ? colors.torch : colors.travertine)
    }
  }
  // Banners hang between the arches.
  for (const banner of COLOSSEUM_BANNERS) {
    paint(banner, wall.top, "|", colors.banner, colors.travertine)
    paint(banner, wall.top + 1, "V", colors.banner, colors.travertine)
  }
  // Arched gate with steps over the forecourt.
  const gateGlow = night ? colors.torch : colors.travertine
  paint(36, 16, "/--\\", colors.arch, gateGlow)
  paint(36, 17, "|  |", colors.arch, gateGlow)
  paint(34, COLOSSEUM_GROUND_TOP - 1, "========", colors.travertineDark)
  // Cypress sentinels flank the ruin.
  for (const cypress of COLOSSEUM_CYPRESS) {
    paint(cypress, 13, "/\\", colors.cypress)
    for (let y = 14; y <= 17; y++) {
      paint(cypress, y, "||", colors.cypress)
    }
  }
  // Braziers flicker beside the gate.
  const torch = colosseumTorch(elapsedMs)
  for (const brazier of [10, 65]) {
    paint(brazier, COLOSSEUM_GROUND_TOP - 1, torch ? "*" : ".", colors.torch)
  }
  // Statues stand in the crown gaps.
  for (const statue of COLOSSEUM_STATUES) {
    paint(statue, wall.top - 2, "o", colors.arch)
    paint(statue, wall.top - 1, "|", colors.arch)
  }
  // Umbrella pines frame the far edges.
  for (const pine of COLOSSEUM_PINES) {
    paint(pine - 1, 11, "___", colors.pine)
    for (let y = 12; y <= 17; y++) {
      paint(pine, y, "|", colors.pine)
    }
  }
  // Gladiators flank the gate while tourist cameras flash in turn.
  for (const gladiator of COLOSSEUM_GLADIATORS) {
    paint(gladiator, 17, "o", colors.crowd, colors.travertine)
    paint(gladiator, COLOSSEUM_GROUND_TOP - 1, "i", colors.crowd)
  }
  const flash = colosseumFlash(elapsedMs)
  COLOSSEUM_FLASH.forEach((camera, i) => {
    paint(camera, COLOSSEUM_GROUND_TOP - 1, i === flash ? "*" : ".", i === flash ? colors.torch : colors.crowd)
  })
  for (let y = COLOSSEUM_GROUND_TOP; y < COLOSSEUM_ROWS; y++) {
    paint(0, y, " ".repeat(COLOSSEUM_COLUMNS), colors.ground, colors.ground)
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
