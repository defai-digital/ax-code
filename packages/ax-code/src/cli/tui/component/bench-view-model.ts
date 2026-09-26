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
  }
  if (h >= 12 && w >= 16) {
    const body = [" .---. ", "/     \\", "|     |", "\\     /", " '---' "]
    const x = benchSunX(w)
    const y = benchSunY(style, elapsedMs, horizon)
    for (let i = 0; i < body.length; i++) if (y + i < horizon) paint(x, y + i, body[i]!, colors.light)
  }
  if (h >= 10 && w >= 14) {
    const trunk = benchTrunk(w)
    const canopy = benchCanopy(horizon)
    const sway = benchSway(elapsedMs, w)
    paint(trunk - 4 + sway, canopy, " _\\|//_ ", colors.palm)
    paint(trunk - 6 + sway, canopy + 1, "_\\\\|////_", colors.palm)
    paint(trunk - 3 + sway, canopy + 2, "// | \\", colors.palm)
    for (let y = canopy + 3; y < horizon; y++) paint(trunk - Math.floor((y - canopy - 3) / 2), y, "//", colors.trunk)
  }
  const phase = benchWavePhase(elapsedMs)
  for (let x = 0; x < w; x++) {
    paint(x, horizon, (x + phase) % 2 === 0 ? "~" : " ", colors.wave)
    paint(x, horizon + 1, (x + 2 - phase) % 3 === 0 ? "~" : " ", colors.foam)
    paint(x, horizon + 2, "_", colors.sand)
    paint(x, horizon + 3, x % 3 === 1 ? "." : " ", colors.sand)
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
