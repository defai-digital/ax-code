import type { FujiRun } from "./fuji-view-model"

export type FestivalStyle = "festival-fireworks" | "festival-lanterns"
export function isFestivalStyle(style: string | undefined): style is FestivalStyle {
  return style === "festival-fireworks" || style === "festival-lanterns"
}

/** Reference composition size shared by both renderers. */
export const FESTIVAL_COLUMNS = 76
export const FESTIVAL_ROWS = 25
export const FESTIVAL_CYCLE_MS = 3600
export const FESTIVAL_TOWN = [10, 24, 38, 52, 66] as const
export const FESTIVAL_TOWN_ROW = 22
export const FESTIVAL_GROUND_TOP = 23
export const FESTIVAL_MOON = { x: 50, y: 2 } as const

/** Palette shared by the text and pixel renderers. */
export const FESTIVAL_COLORS = {
  "festival-fireworks": {
    sky: "#8a93b8",
    skyBottom: "#0d0d24",
    ground: "#0a0a18",
    townDot: "#ffd166",
  },
  "festival-lanterns": {
    sky: "#9fb0d8",
    skyBottom: "#1c2a55",
    ground: "#0c1226",
    townDot: "#ffd166",
  },
} as const satisfies Record<FestivalStyle, Record<string, string>>

export const FESTIVAL_BURST_BRIGHT = "#fff2cc"
export const FESTIVAL_LANTERN_COLORS = {
  body: "#ffb14e",
  core: "#ffe6b3",
  glow: "#4a2f1a",
  halo: "#6b4423",
  dark: "#241610",
} as const
export const FESTIVAL_MOONLIGHT = "#e8ecf8"

export function festivalBackground(style: FestivalStyle) {
  return style === "festival-fireworks" ? "#050510" : "#0a1030"
}

/** Sample the vertical sky gradient. `t` is 0 at the top of the frame. */
export function festivalSkyRgb(style: FestivalStyle, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(festivalBackground(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(FESTIVAL_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

export const FESTIVAL_BURSTS = [
  { x: 18, y: 9 },
  { x: 38, y: 6 },
  { x: 58, y: 10 },
] as const
export const FESTIVAL_BURST_HUES = ["#ffd166", "#ff5a5a", "#6ee7ff"] as const
export const FESTIVAL_BURST_DIM = ["#6b5326", "#662626", "#2a5a66"] as const
const BURST_PARTICLES = 16
const BURST_REACH = 5
const BURST_VISIBLE_MS = 2200

/** Staggered burst age reduced into the shared cycle, so loop frames match bit for bit. */
export function festivalBurstAge(elapsedMs: number, burst: number): number {
  const t = Math.max(0, elapsedMs) % FESTIVAL_CYCLE_MS
  return (((t - burst * 1200) % FESTIVAL_CYCLE_MS) + FESTIVAL_CYCLE_MS) % FESTIVAL_CYCLE_MS
}

export type FestivalParticle = { x: number; y: number; stage: number }
/** Radial sparks around the burst center. Stage -1 has faded out. */
export function festivalParticles(elapsedMs: number, burst: number): FestivalParticle[] {
  const center = FESTIVAL_BURSTS[burst]!
  const age = festivalBurstAge(elapsedMs, burst)
  const stage = age < 350 ? 0 : age < 1100 ? 1 : age < BURST_VISIBLE_MS ? 2 : -1
  const reach = Math.min(age / 800, 1) * BURST_REACH
  return Array.from({ length: BURST_PARTICLES }, (_, k) => {
    const angle = (2 * Math.PI * k) / BURST_PARTICLES + burst * 0.4
    return { x: center.x + Math.cos(angle) * reach, y: center.y + Math.sin(angle) * reach * 0.8, stage }
  })
}

export type FestivalRocket = { x: number; y: number }
/**
 * The ascending rocket before a burst: visible while the burst age is in the
 * last 600ms of the cycle, climbing from the town row to the burst center.
 */
export function festivalRocket(elapsedMs: number, burst: number): FestivalRocket | null {
  const center = FESTIVAL_BURSTS[burst]!
  const age = festivalBurstAge(elapsedMs, burst)
  if (age < FESTIVAL_CYCLE_MS - 600) return null
  const p = (age - (FESTIVAL_CYCLE_MS - 600)) / 600
  return { x: center.x, y: FESTIVAL_TOWN_ROW + (center.y - FESTIVAL_TOWN_ROW) * p }
}

/** Lantern flames flicker together on a 400ms beat, bright at rest. */
export function festivalLanternBright(elapsedMs: number): boolean {
  return Math.floor(Math.max(0, elapsedMs) / 200) % 2 === 0
}

export type FestivalLantern = { x: number; y: number }
/** Rising lanterns with a whole number of laps and sways per cycle, so the sky loops. */
export function festivalLanterns(elapsedMs: number): FestivalLantern[] {
  const t = Math.max(0, elapsedMs) % FESTIVAL_CYCLE_MS
  const range = 29
  return Array.from({ length: 9 }, (_, i) => {
    const x0 = 5 + i * 7 + ((i * 37) % 3)
    const rounds = 1 + (i % 2)
    const swayRounds = 1 + (i % 2)
    const y = -2 + ((((((i * 53) % 20) + (range * rounds * t) / FESTIVAL_CYCLE_MS) % range) + range) % range)
    const x = x0 + Math.sin((2 * Math.PI * swayRounds * t) / FESTIVAL_CYCLE_MS + i) * 1.5
    return { x, y }
  })
}

export function festivalRows(columns: number, rows: number, style: FestivalStyle, elapsedMs: number): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const fireworks = style === "festival-fireworks"
  const colors = FESTIVAL_COLORS[style]
  const grid: FujiRun[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: colors.sky })),
  )
  const left = Math.floor((width - FESTIVAL_COLUMNS) / 2),
    top = Math.floor((height - FESTIVAL_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + Math.round(y)
    if (row < 0 || row >= height) return
    for (let i = 0; i < text.length; i++) {
      const sceneX = Math.round(x) + i
      const column = left + sceneX
      if (sceneX < 0 || sceneX >= FESTIVAL_COLUMNS || column < 0 || column >= width) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }
  if (fireworks) {
    paint(3, 0, ".    *      .       *", colors.sky)
    paint(30, 1, "*      .      *", colors.sky)
  } else {
    paint(3, 0, ".    *      .       *      .", colors.sky)
    paint(6, 1, "*     .      *", colors.sky)
    paint(FESTIVAL_MOON.x - 1, FESTIVAL_MOON.y - 1, ".-.", FESTIVAL_MOONLIGHT)
    paint(FESTIVAL_MOON.x - 2, FESTIVAL_MOON.y, "(   )", FESTIVAL_MOONLIGHT)
  }
  paint(0, FESTIVAL_GROUND_TOP, " ".repeat(FESTIVAL_COLUMNS), colors.ground, colors.ground)
  paint(0, FESTIVAL_GROUND_TOP + 1, " ".repeat(FESTIVAL_COLUMNS), colors.ground, colors.ground)
  for (const dot of FESTIVAL_TOWN) paint(dot, FESTIVAL_TOWN_ROW, "*", colors.townDot)
  if (fireworks) {
    for (let burst = 0; burst < FESTIVAL_BURSTS.length; burst++) {
      const rocket = festivalRocket(elapsedMs, burst)
      if (rocket) {
        paint(rocket.x, rocket.y, "*", FESTIVAL_BURST_BRIGHT)
        for (let k = 1; k <= 3; k++) {
          if (rocket.y + k <= FESTIVAL_TOWN_ROW) paint(rocket.x, rocket.y + k, "|", FESTIVAL_BURST_DIM[burst]!)
        }
      }
      for (const particle of festivalParticles(elapsedMs, burst)) {
        if (particle.stage < 0) continue
        const char = particle.stage === 0 ? "*" : particle.stage === 1 ? "+" : "."
        const color =
          particle.stage === 0
            ? FESTIVAL_BURST_BRIGHT
            : particle.stage === 1
              ? FESTIVAL_BURST_HUES[burst]!
              : FESTIVAL_BURST_DIM[burst]!
        paint(particle.x, particle.y, char, color)
      }
    }
  } else {
    const flame = festivalLanternBright(elapsedMs) ? FESTIVAL_LANTERN_COLORS.glow : FESTIVAL_LANTERN_COLORS.dark
    for (const lantern of festivalLanterns(elapsedMs)) {
      paint(lantern.x - 1, lantern.y - 1, ".-.", FESTIVAL_LANTERN_COLORS.body)
      paint(lantern.x - 1, lantern.y, "( )", FESTIVAL_LANTERN_COLORS.body, flame)
      paint(lantern.x - 1, lantern.y + 1, "'-'", FESTIVAL_LANTERN_COLORS.body)
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
