export type FujiStyle = "fuji-day" | "fuji-night"
export function isFujiStyle(style: string | undefined): style is FujiStyle {
  return style === "fuji-day" || style === "fuji-night"
}
export function fujiBackground(style: FujiStyle) {
  return style === "fuji-day" ? "#a8dadc" : "#101b36"
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
        snow: "#d9e5f5",
        mountain: "#557a85",
        blossom: "#ce91b5",
        trunk: "#aa9292",
        track: "#7b8aab",
      }
    : {
        sky: "#f1faee",
        light: "#ffb703",
        snow: "#ffffff",
        mountain: "#1b4332",
        blossom: "#ffb5a7",
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
  // and hundreds of blank padding characters in the browser example.
  const phase = (Math.max(0, elapsedMs) % TRAIN_CYCLE_MS) / TRAIN_CYCLE_MS
  const trainX = Math.floor(phase * (SCENE_WIDTH + TRAIN_WIDTH)) - TRAIN_WIDTH
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
