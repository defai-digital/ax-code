export type FujiStyle = "fuji-dawn" | "fuji-night"
export function isFujiStyle(style: string | undefined): style is FujiStyle {
  return style === "fuji-dawn" || style === "fuji-night"
}

/** Dawn/night sky stops from the reference widget: top, mid, bottom. */
export const FUJI_SKY_STOPS: Record<FujiStyle, readonly [string, string, string]> = {
  "fuji-dawn": ["#1e1b4b", "#4338ca", "#f43f5e"],
  "fuji-night": ["#030814", "#0c1b33", "#1d3557"],
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
  return FUJI_SKY_STOPS[style][1]
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
        sky: "#e0f2fe",
        light: "#f1faee",
        snow: "#e0f2fe",
        mountain: "#3c6782",
        blossom: "#ce91b5",
        trunk: "#aa9292",
        track: "#7b8aab",
      }
    : {
        sky: "#e0e7ff",
        light: "#fbbf24",
        snow: "#fef08a",
        mountain: "#1e1035",
        blossom: "#ffb7c5",
        trunk: "#6c584c",
        track: "#1e293b",
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
    paint(9, 0, "*              .                  *", colors.sky)
    paint(7, 1, "        .                *", colors.sky)
    paint(31, 2, " .-. ", colors.light)
    paint(28, 3, "   (   )", colors.light)
  } else {
    paint(0, 0, "         _ ._  _ _", colors.sky)
    paint(0, 1, "       (  _ )_ ( _  )", colors.sky)
    paint(31, 2, ".---.", colors.light)
    paint(28, 3, ".-'     '-.", colors.light)
  }
  paint(27, 4, '/"""""""""\\', colors.snow)
  paint(26, 5, "/           \\", colors.snow)
  paint(25, 6, "/             \\", colors.mountain)
  paint(24, 7, "/               \\", colors.mountain)
  paint(23, 8, "/                 \\", colors.mountain)
  paint(21, 9, "_/                   \\_", colors.mountain)
  paint(0, 10, "____________________/                       \\_____________________", colors.mountain)
  paint(0, 11, "    _.._         _.._                _.._               _.._", colors.blossom)
  paint(0, 12, "  (      )     (      )            (      )           (      )", colors.blossom)
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
