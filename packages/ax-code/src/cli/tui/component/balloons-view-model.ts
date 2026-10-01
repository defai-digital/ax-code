import type { FujiRun } from "./fuji-view-model"

export type BalloonsStyle = "balloons-night" | "balloons-dawn"
export function isBalloonsStyle(style: string | undefined): style is BalloonsStyle {
  return style === "balloons-night" || style === "balloons-dawn"
}

/** Reference composition size shared by both renderers. */
export const BALLOONS_COLUMNS = 76
export const BALLOONS_ROWS = 24
export const BALLOONS_COUNT = 5
export const BALLOONS_GROUND_TOP = 19
export const BALLOONS_CYCLE_MS = 9600
/** Fairy-chimney rock spires along the valley floor. */
export const BALLOONS_SPIRES = [8, 20, 55, 66] as const
/** Night stars in row-major order, shared by both renderers. */
export const BALLOONS_STARS = [
  { x: 3, y: 0 },
  { x: 30, y: 1 },
  { x: 45, y: 0 },
  { x: 60, y: 2 },
  { x: 72, y: 1 },
] as const
/** Moon (night) / low sun (dawn) shared by both renderers. */
export const BALLOONS_MOON = { x: 66, y: 3 } as const
/** Drifting valley clouds: [x, y, width]. */
export const BALLOONS_CLOUDS = [
  [14, 5, 10],
  [44, 7, 12],
] as const
/** Scrub tufts along the valley floor. */
export const BALLOONS_SCRUB = [3, 25, 47, 69] as const
/** Distant balloons hanging high behind the lanes. */
export const BALLOONS_FAR = [
  { x: 18, y: 2 },
  { x: 52, y: 1 },
] as const
export const BALLOONS_BIRD_COUNT = 3
/** Valley cottages tucked between the spires. */
export const BALLOONS_COTTAGES = [30, 44] as const
export const BALLOONS_TETHER = { x: 36, top: 16 } as const

/** Palette shared by the text and pixel renderers. */
export const BALLOONS_COLORS = {
  "balloons-night": {
    sky: "#8ba0c8",
    skyBottom: "#232a55",
    moon: "#e8e4f5",
    cloud: "#2a3358",
    envelope: "#5a4a8a",
    envelopeAlt: "#8a4a6a",
    basket: "#4a3832",
    flame: "#ffd166",
    glow: "#4a4a8a",
    rock: "#3d3a52",
    scrub: "#2a2e44",
    ground: "#1c1e2e",
    far: "#4a4a72",
    house: "#ffd166",
  },
  "balloons-dawn": {
    sky: "#c39a8a",
    skyBottom: "#f2c87a",
    moon: "#fff8e8",
    cloud: "#d89a8a",
    envelope: "#e04a5a",
    envelopeAlt: "#e88a3a",
    basket: "#6a4a32",
    flame: "#fff0d0",
    glow: "#c86a4a",
    rock: "#8a6a52",
    scrub: "#6a523e",
    ground: "#5a4a3a",
    far: "#c36a5a",
    house: "#8a6a52",
  },
} as const satisfies Record<BalloonsStyle, Record<string, string>>

export function balloonsBackground(style: BalloonsStyle) {
  return style === "balloons-night" ? "#0e1433" : "#b87a6a"
}

/** Sample the vertical sky gradient. `t` is 0 at the top of the frame. */
export function balloonsSkyRgb(style: BalloonsStyle, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(balloonsBackground(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(BALLOONS_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

export type Balloon = { x: number; y: number; alt: boolean }
/** Balloons rising through the valley on a shared 9600ms round. */
export function balloonsAscend(elapsedMs: number): Balloon[] {
  const t = Math.max(0, elapsedMs)
  return Array.from({ length: BALLOONS_COUNT }, (_, i) => {
    const lane = 8 + i * 13
    const rise = ((i * 5 + Math.floor(t / 400)) % 16) as number
    const sway = Math.round(Math.sin((t / 2400) * Math.PI * 2 + i) * 2)
    return { x: lane + sway, y: 15 - rise, alt: i % 2 === 1 }
  })
}

/** Burner flame flickers on a 600ms round. */
export function balloonsFlame(elapsedMs: number): boolean {
  return Math.floor(Math.max(0, elapsedMs) / 150) % 4 < 2
}

/** Valley clouds drift on a slow beat, the second trailing the first. */
export function balloonsCloudDrift(elapsedMs: number): number {
  return Math.floor(Math.max(0, elapsedMs) / 600) % 5
}

export type BalloonsBird = { x: number; y: number }
/** Swifts crossing between the lanes. */
export function balloonsBirds(elapsedMs: number): BalloonsBird[] {
  const step = Math.floor(Math.max(0, elapsedMs) / 320) * 2
  return Array.from({ length: BALLOONS_BIRD_COUNT }, (_, i) => ({
    x: (i * 29 + 12 + step) % (BALLOONS_COLUMNS + 8),
    y: 6 + (i % 2),
  }))
}

export function balloonsRows(columns: number, rows: number, style: BalloonsStyle, elapsedMs: number): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const night = style === "balloons-night"
  const colors = BALLOONS_COLORS[style]
  const flame = balloonsFlame(elapsedMs)
  const cloudDrift = balloonsCloudDrift(elapsedMs)
  const grid: FujiRun[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: colors.sky })),
  )
  const left = Math.floor((width - BALLOONS_COLUMNS) / 2),
    top = Math.floor((height - BALLOONS_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + Math.round(y)
    if (row < 0 || row >= height) return
    for (let i = 0; i < text.length; i++) {
      const sceneX = Math.round(x) + i
      const column = left + sceneX
      if (sceneX < 0 || sceneX >= BALLOONS_COLUMNS || column < 0 || column >= width) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }
  if (night) {
    BALLOONS_STARS.forEach((star, i) => {
      paint(star.x, star.y, (Math.floor(Math.max(0, elapsedMs) / 400) + i) % 3 === 0 ? "*" : ".", colors.sky)
    })
  }
  // Moonrise over the valley, sunrise at dawn.
  const moon = BALLOONS_MOON
  paint(moon.x, moon.y, "O", colors.moon)
  paint(moon.x, moon.y - 1, ".", colors.moon)
  paint(moon.x, moon.y + 1, ".", colors.moon)
  paint(moon.x - 1, moon.y, ".", colors.moon)
  paint(moon.x + 1, moon.y, ".", colors.moon)
  // Low clouds drift across the lanes.
  const [cloud0, cloud1] = BALLOONS_CLOUDS
  paint(cloud0![0] + cloudDrift, cloud0![1], "~".repeat(cloud0![2]), colors.cloud)
  paint(cloud1![0] + ((cloudDrift + 2) % 5), cloud1![1], "~".repeat(cloud1![2]), colors.cloud)
  // Distant balloons hanging high behind the lanes.
  for (const distant of BALLOONS_FAR) {
    paint(distant.x, distant.y, "o", colors.far)
    paint(distant.x, distant.y + 1, "|", colors.basket)
  }
  for (const spire of BALLOONS_SPIRES) {
    paint(spire, BALLOONS_GROUND_TOP - 4, "/\\", colors.rock)
    paint(spire, BALLOONS_GROUND_TOP - 3, "||", colors.rock)
    paint(spire, BALLOONS_GROUND_TOP - 2, "||", colors.rock)
    paint(spire - 1, BALLOONS_GROUND_TOP - 1, "====", colors.rock)
  }
  // Valley cottages tucked between the spires.
  for (const cottage of BALLOONS_COTTAGES) {
    paint(cottage, 17, "/\\", colors.house)
    paint(cottage, 18, "||", colors.house)
  }
  // A tethered envelope inflating with its crew.
  const tether = BALLOONS_TETHER
  paint(tether.x - 1, tether.top, ".---.", colors.envelope)
  paint(tether.x - 2, tether.top + 1, "(   )", colors.envelope)
  paint(tether.x + 1, tether.top + 2, "o", colors.basket)
  for (const balloon of balloonsAscend(elapsedMs)) {
    const envelope = balloon.alt ? colors.envelopeAlt : colors.envelope
    paint(balloon.x - 2, balloon.y, ".---.", envelope)
    paint(balloon.x - 3, balloon.y + 1, "(     )", envelope)
    paint(balloon.x, balloon.y + 1, "|", colors.flame, envelope)
    paint(balloon.x - 2, balloon.y + 2, "\\___/", envelope)
    paint(balloon.x, balloon.y + 3, "|", colors.basket)
    paint(balloon.x - 1, balloon.y + 4, flame ? "[*]" : "[ ]", flame ? colors.flame : colors.basket)
    if (flame) {
      paint(balloon.x - 2, balloon.y + 4, ".", colors.glow)
      paint(balloon.x + 2, balloon.y + 4, ".", colors.glow)
    }
  }
  // Swifts crossing between the lanes.
  const flap = Math.floor(Math.max(0, elapsedMs) / 300) % 2 === 0
  for (const swift of balloonsBirds(elapsedMs)) {
    paint(swift.x, swift.y, flap ? "v" : "^", colors.basket)
  }
  for (let y = BALLOONS_GROUND_TOP; y < BALLOONS_ROWS; y++) {
    paint(0, y, " ".repeat(BALLOONS_COLUMNS), colors.ground, colors.ground)
  }
  // Scrub dots the valley floor.
  for (const scrub of BALLOONS_SCRUB) {
    paint(scrub, BALLOONS_GROUND_TOP + 1, "/\\", colors.scrub, colors.ground)
  }
  // Foreground grasses wave below the scrub.
  for (let x = 2; x < BALLOONS_COLUMNS; x += 6) {
    paint(x, BALLOONS_GROUND_TOP + 3, '"', colors.scrub, colors.ground)
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
