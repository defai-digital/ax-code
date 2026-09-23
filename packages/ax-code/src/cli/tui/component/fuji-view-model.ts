export type FujiStyle = "fuji-day" | "fuji-night"
export function isFujiStyle(style: string | undefined): style is FujiStyle {
  return style === "fuji-day" || style === "fuji-night"
}

/** Day/night sky stops from the reference: top, mid, bottom. */
export const FUJI_SKY_STOPS: Record<FujiStyle, readonly [string, string, string]> = {
  "fuji-day": ["#a8dadc", "#d0eff0", "#fee5bf"],
  "fuji-night": ["#101b36", "#182848", "#1d3557"],
}

const hexRgb = (hex: string): readonly [number, number, number] =>
  [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number]

/** Sample the vertical sky gradient. `t` is 0 at the top of the frame. */
export function fujiSkyRgb(style: FujiStyle, t: number): readonly [number, number, number] {
  const stops = FUJI_SKY_STOPS[style].map(hexRgb)
  const x = Math.max(0, Math.min(1, t))
  const from = x <= 0.5 ? stops[0]! : stops[1]!
  const to = x <= 0.5 ? stops[1]! : stops[2]!
  const u = x <= 0.5 ? x * 2 : (x - 0.5) * 2
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * u)) as [
    number,
    number,
    number,
  ]
}

export function fujiBackground(style: FujiStyle) {
  return FUJI_SKY_STOPS[style][0]
}
export type FujiRun = { text: string; color: string; background?: string }
// Preserve the user's original artwork, including the left-facing train.
const TRAIN = [
  "  _____     ____________________   ____________________ ",
  " /     \\___| [] [] [] [] [] [] | _| [] [] [] [] [] [] |_",
  "[  JR   ___  __  __  __  __  __  |   __  __  __  __  __  |",
  "========(_)==================(_)=======(_)============(_)",
]
const SCENE_WIDTH = 74
const SCENE_HEIGHT = 20
const TRAIN_WIDTH = Math.max(...TRAIN.map((line) => line.length))
const TRAIN_CYCLE_MS = 2400

export function fujiRows(columns: number, rows: number, style: FujiStyle, elapsedMs: number): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const night = style === "fuji-night"
  const colors = night
    ? {
        sky: "#8ba6d1",
        light: "#e2eafc",
        moonBg: "#cbd5e1",
        snow: "#d9e5f5",
        snowBg: "#94a3b8",
        mountain: "#557a85",
        mountainBg: "#2d4454",
        blossom: "#ce91b5",
        blossomBg: "#4a2d48",
        trunk: "#aa9292",
        track: "#7b8aab",
      }
    : {
        sky: "#f1faee",
        light: "#ffb703",
        sunBg: "#fef08a",
        snow: "#ffffff",
        snowBg: "#f8fafc",
        mountain: "#1b4332",
        mountainBg: "#24533f",
        blossom: "#ffb5a7",
        blossomBg: "#fecdd3",
        trunk: "#6c584c",
        track: "#495057",
      }
  const grid: FujiRun[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: colors.sky })),
  )
  // Center the original 74x20 composition. Small terminals crop it rather
  // than changing the mountain's proportions or rearranging the trees.
  const left = Math.floor((width - SCENE_WIDTH) / 2),
    top = Math.floor((height - SCENE_HEIGHT) / 2)
  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + y
    if (row < 0 || row >= height) return
    for (let i = 0; i < text.length; i++) {
      const column = left + x + i
      if (x + i < 0 || x + i >= SCENE_WIDTH || column < 0 || column >= width) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }
  if (night) {
    // Star field from the supplied reference, which spreads stars right across
    // the sky instead of leaving the two original rows sparse. The pattern is
    // fixed for the lifetime of the frame on purpose: the pixel transport keeps
    // the upper region byte-identical between frames while only the train moves.
    paint(4, 0, ".       *              .                  *       .", colors.sky)
    paint(2, 1, "*         .                *            .     *", colors.sky)
    paint(6, 2, ".     *     .    +      *    .     *    .", colors.sky)
    paint(4, 3, "*    .    +     .     *     .    +    *", colors.sky)
    paint(31, 2, " .-. ", colors.light)
    paint(32, 2, ".-.", colors.light, colors.moonBg)
    paint(28, 3, "   (   )", colors.light)
    paint(32, 3, "   ", colors.light, colors.moonBg)
  } else {
    paint(0, 0, "         _ ._  _ _", colors.sky)
    paint(0, 1, "       (  _ )_ ( _  )", colors.sky)
    paint(31, 2, ".---.", colors.light, colors.sunBg)
    paint(28, 3, ".-'     '-.", colors.light)
    paint(31, 3, "     ", colors.light, colors.sunBg)
  }
  paint(27, 4, '/"""""""""\\', colors.snow)
  paint(28, 4, '"""""""""', colors.snow, colors.snowBg)
  paint(26, 5, "/           \\", colors.snow)
  paint(27, 5, "           ", colors.snow, colors.snowBg)
  paint(25, 6, "/             \\", colors.mountain)
  paint(26, 6, "             ", colors.mountain, colors.mountainBg)
  paint(24, 7, "/               \\", colors.mountain)
  paint(25, 7, "               ", colors.mountain, colors.mountainBg)
  paint(23, 8, "/                 \\", colors.mountain)
  paint(24, 8, "                 ", colors.mountain, colors.mountainBg)
  paint(21, 9, "_/                   \\_", colors.mountain)
  paint(23, 9, "                   ", colors.mountain, colors.mountainBg)
  paint(0, 10, "____________________/                       \\_____________________", colors.mountain)
  paint(21, 10, "                       ", colors.mountain, colors.mountainBg)
  paint(0, 11, "    _.._         _.._                _.._               _.._", colors.blossom)
  paint(0, 12, "  (      )     (      )            (      )           (      )", colors.blossom)
  paint(3, 12, "      ", colors.blossom, colors.blossomBg)
  paint(16, 12, "      ", colors.blossom, colors.blossomBg)
  paint(36, 12, "      ", colors.blossom, colors.blossomBg)
  paint(55, 12, "      ", colors.blossom, colors.blossomBg)
  paint(0, 13, "     ||           ||                  ||                 ||", colors.trunk)
  // Both original platform rows sit above the train.
  paint(0, 14, "_".repeat(SCENE_WIDTH), colors.track)
  paint(0, 15, "=".repeat(SCENE_WIDTH), colors.track)
  // Use elapsed time and a bounded traversal instead of frame-dependent speed
  // and hundreds of blank padding characters in the browser example. The train
  // keeps its left-facing nose, so it enters from the right and exits left
  // rather than travelling backwards across the frame.
  const phase = (Math.max(0, elapsedMs) % TRAIN_CYCLE_MS) / TRAIN_CYCLE_MS
  // One extra column of travel so the final frame lands the tail fully past the
  // left edge; without it the last glyph sat on column 0 and the next frame
  // teleported the train back to the right edge.
  const trainX = SCENE_WIDTH - Math.floor(phase * (SCENE_WIDTH + TRAIN_WIDTH + 1))
  for (let line = 0; line < TRAIN.length; line++) paint(trainX, 16 + line, TRAIN[line]!, "#edf2f4", "#1d3557")
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
