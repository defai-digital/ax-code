export type BenchStyle = "midnight-dream" | "sunset-serenade"
export function isBenchStyle(style: string | undefined): style is BenchStyle {
  return style === "midnight-dream" || style === "sunset-serenade"
}

/** Reference composition size shared by both renderers. */
export const BENCH_COLUMNS = 70
export const BENCH_ROWS = 23

/** Palette shared by the text and pixel renderers. */
export const BENCH_COLORS = {
  "midnight-dream": {
    sky: "#5c677d",
    skyBottom: "#1e2c4e",
    light: "#e2eafc",
    palm: "#4ad66d",
    trunk: "#b79457",
    wave: "#00b4d8",
    foam: "#90e0ef",
    sand: "#e9c46a",
    sandWet: "#a8824f",
    cloud: "#8fa3c8",
  },
  "sunset-serenade": {
    sky: "#e99887",
    skyBottom: "#74384a",
    light: "#ffcd75",
    palm: "#bc9658",
    trunk: "#a16c50",
    wave: "#c36b9b",
    foam: "#ffb8a4",
    sand: "#e9c46a",
    sandWet: "#c08a5a",
    cloud: "#f5b8a8",
  },
} as const satisfies Record<BenchStyle, Record<string, string>>

export function benchBackground(style: BenchStyle) {
  return style === "midnight-dream" ? "#0b132b" : "#341b36"
}

/** Sample the vertical sky gradient. `t` is 0 at the top of the frame. */
export function benchSkyRgb(style: BenchStyle, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(benchBackground(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(BENCH_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

const benchTime = (elapsedMs: number) => Math.max(0, elapsedMs) / 1000

/** Wave horizon row for a composition height. */
export function benchHorizon(height: number): number {
  return Math.max(0, height - 5)
}

/** Celestial body column for a composition width. */
export function benchSunX(width: number): number {
  return Math.min(width - 7, Math.floor(width * 0.7))
}

/** Celestial body row. The midnight moon is fixed; the sunset descends and settles. */
export function benchSunY(style: BenchStyle, elapsedMs: number, horizon: number): number {
  if (style === "midnight-dream") return 1
  return Math.max(1, horizon - 6 + Math.floor(Math.min(benchTime(elapsedMs) / 3, 1) * 2))
}

/** Palm sway offset in scene cells. */
export function benchSway(elapsedMs: number, width: number): number {
  return Math.round(Math.sin(benchTime(elapsedMs) * 3) * Math.min(3, width / 20))
}

/** Alternating surf phase. */
export function benchWavePhase(elapsedMs: number): number {
  return Math.floor(benchTime(elapsedMs) * 5) % 2
}

/** Twinkling star glyph: bright on every third beat. */
export function benchStarGlyph(elapsedMs: number, x: number): string {
  return (Math.floor(benchTime(elapsedMs) * 2) + x) % 3 ? "." : "*"
}

/** Star row for a column. */
export function benchStarRow(x: number, horizon: number): number {
  return (x * 7) % Math.max(1, Math.min(5, horizon))
}

/** Faint second star layer interleaved between the main stars (midnight only). */
export function benchFaintStarRow(x: number, horizon: number): number {
  return (x * 7 + 3) % Math.max(1, Math.min(5, horizon))
}

/** Faint stars twinkle on the shared beat with an offset phase. */
export function benchFaintStarBright(elapsedMs: number, x: number): boolean {
  return benchStarGlyph(Math.max(0, elapsedMs) + 450, x + 2) === "*"
}

/** Drifting sunset cloud banks: base column, scene row, length, and cells per second. */
export const BENCH_CLOUDS = [
  { base: 8, y: 3, len: 6, speed: 1.5 },
  { base: 40, y: 5, len: 8, speed: 1.0 },
] as const

export function benchCloudX(base: number, speed: number, elapsedMs: number, width: number): number {
  const span = Math.max(1, width + 16)
  return ((((base + benchTime(elapsedMs) * speed) % span) + span) % span) - 8
}

export function benchClouds(style: BenchStyle, elapsedMs: number, width: number) {
  if (style !== "sunset-serenade") return []
  return BENCH_CLOUDS.map((cloud) => ({
    x: benchCloudX(cloud.base, cloud.speed, elapsedMs, width),
    y: cloud.y,
    len: cloud.len,
  }))
}

/** Halo ticks around the sun/moon body at scene (x, y). */
export function benchHaloTicks(x: number, y: number) {
  return [
    { x: x - 1, y: y + 2 },
    { x: x + 7, y: y + 2 },
    { x: x + 3, y: y - 1 },
    { x: x + 3, y: y + 5 },
  ]
}

/** Shimmering sun/moon reflection cells on the surf rows, gated by the wave phase. */
export function benchReflection(elapsedMs: number, width: number, horizon: number) {
  const sunX = benchSunX(width)
  const phase = benchWavePhase(elapsedMs)
  const cells: { x: number; y: number }[] = []
  for (let x = sunX + 2; x <= sunX + 4; x++) {
    if ((x + phase) % 2 !== 0) continue
    cells.push({ x, y: horizon }, { x, y: horizon + 1 })
  }
  return cells
}

/** Shells resting on the dotted sand row. */
export const BENCH_SHELLS = [
  { x: 10, glyph: "o" },
  { x: 45, glyph: "*" },
] as const

/** Palm trunk column and canopy row. */
export function benchTrunk(width: number): number {
  return Math.max(4, Math.floor(width * 0.25))
}
export function benchCanopy(horizon: number): number {
  return Math.max(1, horizon - 7)
}

export function benchTitle(style: BenchStyle): string {
  return style === "sunset-serenade" ? "SUNSET SERENADE" : "MIDNIGHT DREAM"
}

export function benchCenterX(text: string, width: number): number {
  return Math.floor((width - text.length) / 2)
}

/** A terminal-native adaptation of the supplied tropical beach ASCII scene. */
export function benchRows(columns: number, rows: number, style: BenchStyle, elapsedMs: number) {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const sunset = style === "sunset-serenade"
  const colors = BENCH_COLORS[style]
  const grid: { text: string; color: string }[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: colors.sky })),
  )
  const w = Math.min(BENCH_COLUMNS, width),
    h = Math.min(BENCH_ROWS, height)
  const left = Math.floor((width - w) / 2),
    top = Math.floor((height - h) / 2)
  const paint = (x: number, y: number, text: string, color: string) => {
    if (y < 0 || y >= h) return
    for (let i = 0; i < text.length; i++) {
      if (x + i < 0 || x + i >= w) continue
      grid[top + y]![left + x + i] = { text: text[i]!, color }
    }
  }
  const horizon = benchHorizon(h)
  if (!sunset) {
    for (let x = 3; x < w; x += 9) {
      paint(x, benchStarRow(x, horizon), benchStarGlyph(elapsedMs, x), colors.sky)
    }
    for (let x = 7; x < w; x += 9) {
      if (benchFaintStarBright(elapsedMs, x)) paint(x, benchFaintStarRow(x, horizon), "*", colors.sky)
    }
  }
  if (h >= 12 && w >= 16) {
    const body = [" .---. ", "/     \\", "|     |", "\\     /", " '---' "]
    const x = benchSunX(w)
    const y = benchSunY(style, elapsedMs, horizon)
    for (let i = 0; i < body.length; i++) if (y + i < horizon) paint(x, y + i, body[i]!, colors.light)
    for (const tick of benchHaloTicks(x, y)) paint(tick.x, tick.y, ":", colors.light)
  }
  if (sunset) {
    for (const cloud of benchClouds(style, elapsedMs, w)) {
      const x = Math.round(cloud.x)
      paint(x, cloud.y, ".-" + "~".repeat(cloud.len) + "-.", colors.cloud)
      paint(x - 1, cloud.y + 1, "(" + "~".repeat(cloud.len + 2) + ")", colors.cloud)
    }
  }
  if (h >= 10 && w >= 14) {
    const trunk = benchTrunk(w)
    const canopy = benchCanopy(horizon)
    const sway = benchSway(elapsedMs, w)
    paint(trunk - 4 + sway, canopy, " _\\|//_ ", colors.palm)
    paint(trunk - 6 + sway, canopy + 1, "_\\\\|////_", colors.palm)
    paint(trunk - 3 + sway, canopy + 2, "// | \\", colors.palm)
    paint(trunk - 1 + sway, canopy + 2, "o", colors.trunk)
    paint(trunk + 1 + sway, canopy + 2, "o", colors.trunk)
    for (let y = canopy + 3; y < horizon; y++) paint(trunk - Math.floor((y - canopy - 3) / 2), y, "//", colors.trunk)
  }
  const phase = benchWavePhase(elapsedMs)
  for (let x = 0; x < w; x++) {
    paint(x, horizon, (x + phase) % 2 === 0 ? "~" : " ", colors.wave)
    paint(x, horizon + 1, (x + 2 - phase) % 3 === 0 ? "~" : " ", colors.foam)
    paint(x, horizon + 2, "_", colors.sandWet)
    paint(x, horizon + 3, x % 3 === 1 ? "." : " ", colors.sand)
  }
  for (const shell of BENCH_SHELLS) {
    paint(shell.x, horizon + 3, shell.glyph, shell.glyph === "o" ? colors.foam : colors.light)
  }
  for (const cell of benchReflection(elapsedMs, w, horizon)) {
    paint(cell.x, cell.y, ":", colors.light)
  }
  const title = benchTitle(style)
  if (w >= title.length && h >= 8) paint(benchCenterX(title, w), h - 1, title, colors.light)
  return grid.map((row) => {
    const runs: { text: string; color: string }[] = []
    for (const cell of row) {
      const last = runs.at(-1)
      if (last?.color === cell.color) last.text += cell.text
      else runs.push({ ...cell })
    }
    return runs
  })
}
