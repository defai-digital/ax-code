export type BenchStyle = "midnight-dream" | "sunset-serenade"
export function isBenchStyle(style: string | undefined): style is BenchStyle {
  return style === "midnight-dream" || style === "sunset-serenade"
}
export function benchBackground(style: BenchStyle) {
  return style === "midnight-dream" ? "#0b132b" : "#341b36"
}

/** A terminal-native adaptation of the supplied tropical beach ASCII scene. */
export function benchRows(columns: number, rows: number, style: BenchStyle, elapsedMs: number) {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const sunset = style === "sunset-serenade"
  const colors = sunset
    ? {
        sky: "#e99887",
        light: "#ffcd75",
        palm: "#bc9658",
        trunk: "#a16c50",
        wave: "#c36b9b",
        foam: "#ffb8a4",
        sand: "#e9c46a",
      }
    : {
        sky: "#5c677d",
        light: "#e2eafc",
        palm: "#4ad66d",
        trunk: "#b79457",
        wave: "#00b4d8",
        foam: "#90e0ef",
        sand: "#e9c46a",
      }
  const grid = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: colors.sky })),
  )
  const w = Math.min(70, width),
    h = Math.min(23, height)
  const left = Math.floor((width - w) / 2),
    top = Math.floor((height - h) / 2)
  const paint = (x: number, y: number, text: string, color: string) => {
    if (y < 0 || y >= h) return
    for (let i = 0; i < text.length; i++) {
      if (x + i < 0 || x + i >= w) continue
      grid[top + y]![left + x + i] = { text: text[i]!, color }
    }
  }
  const time = Math.max(0, elapsedMs) / 1000
  const horizon = Math.max(0, h - 5)
  if (!sunset) {
    for (let x = 3; x < w; x += 9) {
      paint(x, (x * 7) % Math.max(1, Math.min(5, horizon)), (Math.floor(time * 2) + x) % 3 ? "." : "*", colors.sky)
    }
  }
  if (h >= 12 && w >= 16) {
    const body = [" .---. ", "/     \\", "|     |", "\\     /", " '---' "]
    const x = Math.min(w - 7, Math.floor(w * 0.7))
    const y = sunset ? Math.max(1, horizon - 6 + Math.floor(Math.min(time / 3, 1) * 2)) : 1
    for (let i = 0; i < body.length; i++) if (y + i < horizon) paint(x, y + i, body[i]!, colors.light)
  }
  if (h >= 10 && w >= 14) {
    const trunk = Math.max(4, Math.floor(w * 0.25))
    const canopy = Math.max(1, horizon - 7)
    const sway = Math.round(Math.sin(time * 3) * Math.min(3, w / 20))
    paint(trunk - 4 + sway, canopy, " _\\|//_ ", colors.palm)
    paint(trunk - 6 + sway, canopy + 1, "_\\\\|////_", colors.palm)
    paint(trunk - 3 + sway, canopy + 2, "// | \\", colors.palm)
    for (let y = canopy + 3; y < horizon; y++) paint(trunk - Math.floor((y - canopy - 3) / 2), y, "//", colors.trunk)
  }
  const phase = Math.floor(time * 5) % 2
  for (let x = 0; x < w; x++) {
    paint(x, horizon, (x + phase) % 2 === 0 ? "~" : " ", colors.wave)
    paint(x, horizon + 1, (x + 2 - phase) % 3 === 0 ? "~" : " ", colors.foam)
    paint(x, horizon + 2, "_", colors.sand)
    paint(x, horizon + 3, x % 3 === 1 ? "." : " ", colors.sand)
  }
  const title = sunset ? "SUNSET SERENADE" : "MIDNIGHT DREAM"
  if (w >= title.length && h >= 8) paint(Math.floor((w - title.length) / 2), h - 1, title, colors.light)
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
