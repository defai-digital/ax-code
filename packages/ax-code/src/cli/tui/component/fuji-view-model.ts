export type FujiStyle = "fuji-day" | "fuji-night"
export function isFujiStyle(style: string | undefined): style is FujiStyle {
  return style === "fuji-day" || style === "fuji-night"
}

/** Day/night sky stops from the reference: top, mid, bottom. */
export const FUJI_SKY_STOPS: Record<FujiStyle, readonly [string, string, string]> = {
  "fuji-day": ["#78236e", "#bc4749", "#ff8223"],
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

/** Day/night palette shared by the text and pixel renderers. */
export const FUJI_COLORS = {
  "fuji-night": {
    sky: "#8ba6d1",
    light: "#e2eafc",
    orbBg: "#cbd5e1",
    glowBg: "#2c3a5e",
    snow: "#d9e5f5",
    snowBg: "#94a3b8",
    mountain: "#557a85",
    mountainBg: "#2d4454",
    water: "#9fb6d8",
    waterBg: "#2c4a6e",
    waterDeep: "#1b3252",
    blossom: "#ce91b5",
    blossomBg: "#4a2d48",
    trunk: "#aa9292",
    track: "#7b8aab",
    petal: "#e8d5e0",
    skirt: "#7b8aab",
    jr: "#ffd166",
    train: "#edf2f4",
    trainBg: "#1d3557",
    underBg: "#141b2e",
    wheel: "#8ba6d1",
  },
  "fuji-day": {
    sky: "#ffe5d9",
    light: "#ffe66d",
    orbBg: "#ff9e4f",
    glowBg: "#cf5f4a",
    snow: "#fff1e6",
    snowBg: "#ffc9a8",
    mountain: "#8a5060",
    mountainBg: "#4a2438",
    water: "#ffd9a8",
    waterBg: "#c86964",
    waterDeep: "#8c3c46",
    blossom: "#e0507a",
    blossomBg: "#ff96b4",
    trunk: "#6c584c",
    track: "#5c4a52",
    petal: "#ffd6e0",
    skirt: "#ff8fa3",
    jr: "#ffd166",
    train: "#edf2f4",
    trainBg: "#1d3557",
    underBg: "#402833",
    wheel: "#ffd6c2",
  },
} as const satisfies Record<FujiStyle, Record<string, string>>

export type FujiRun = { text: string; color: string; background?: string }
// Left-facing shinkansen with an aerodynamic nose. It enters from the right
// and exits left, nose-first, like the train it replaces.
const TRAIN = [
  "      _____________________________________________________",
  "  ___/ JR   []    []    []    []    []    []    []    []  |",
  " /________________________________________________________|",
]
export const TRAIN_JR_OFFSET = TRAIN[1]!.indexOf("JR")
export const TRAIN_WHEEL_OFFSETS = [10, 28, 46]
/** Horizontal extent of the nose wedge, in scene cells. Shared by both renderers. */
export const TRAIN_NOSE_CELLS = 6
export const SCENE_WIDTH = 74
export const SCENE_HEIGHT = 20
export const TRAIN_WIDTH = Math.max(...TRAIN.map((line) => line.length))
export const TRAIN_CYCLE_MS = 2400
const PETAL_COUNT = 12
const PETAL_TOP = 3
const PETAL_ROWS = 13

/**
 * Scene-space X of the train's left edge. Shared by the text and pixel paths
 * so both render the train at the same position for the same millisecond.
 */
export function fujiTrainX(elapsedMs: number): number {
  const phase = (Math.max(0, elapsedMs) % TRAIN_CYCLE_MS) / TRAIN_CYCLE_MS
  // One extra column of travel so the final frame lands the tail fully past the
  // left edge; without it the last glyph sat on column 0 and the next frame
  // teleported the train back to the right edge.
  return SCENE_WIDTH - Math.floor(phase * (SCENE_WIDTH + TRAIN_WIDTH + 1))
}

export type FujiPetal = { x: number; y: number; char: string }
/**
 * Deterministic falling petals. Positions derive from elapsed time alone, so
 * every render of the same millisecond is identical and the full scene loops
 * with the train cycle. Petals stay below the celestial band (rows 0-2), which
 * keeps the sun, stars, and moon byte-identical between frames.
 */
export function fujiPetals(elapsedMs: number): FujiPetal[] {
  const phase = (Math.max(0, elapsedMs) % TRAIN_CYCLE_MS) / TRAIN_CYCLE_MS
  return Array.from({ length: PETAL_COUNT }, (_, i) => {
    const y = PETAL_TOP + ((((i * 17 + 1) % PETAL_ROWS) + phase * (8 + (i % 4) * 2)) % PETAL_ROWS)
    const sway = (1 + (i % 2)) * Math.sin(2 * Math.PI * (phase * (1 + (i % 2)) + i / PETAL_COUNT))
    const drifted = ((i * 31 + 5) % SCENE_WIDTH) - phase * (4 + (i % 3) * 3) + sway
    const x = ((drifted % SCENE_WIDTH) + SCENE_WIDTH) % SCENE_WIDTH
    return { x: Math.floor(x), y: Math.floor(y), char: i % 4 === 0 ? "*" : "." }
  })
}

export function fujiRows(columns: number, rows: number, style: FujiStyle, elapsedMs: number): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const night = style === "fuji-night"
  const colors = FUJI_COLORS[style]
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
    // Fixed star field and a moon beside the summit. Its pale fill and the
    // snow cap merged into one white block when it sat above the peak.
    paint(4, 0, ".       *              .                  *       .", colors.sky)
    paint(2, 1, "*         .                *            .     *", colors.sky)
    paint(6, 2, ".     *     .    +      *    .     *    .", colors.sky)
    paint(53, 0, "         ", colors.light, colors.glowBg)
    paint(53, 1, "         ", colors.light, colors.glowBg)
    paint(55, 0, " .-. ", colors.light)
    paint(56, 0, ".-.", colors.light, colors.orbBg)
    paint(52, 1, "   (   )", colors.light)
    paint(56, 1, "   ", colors.light, colors.orbBg)
  } else {
    // Setting sun directly above the summit with a horizon glow band.
    paint(35, 0, ".---.", colors.light, colors.orbBg)
    paint(32, 1, ".-'     '-.", colors.light)
    paint(35, 1, "     ", colors.light, colors.orbBg)
    paint(30, 2, "               ", colors.light, colors.glowBg)
  }
  // Snow-capped Fuji, peak center x=37. Row 6 mixes rock into the cap for a
  // jagged snow line; the base row runs shore to shore above the water.
  paint(35, 3, '/"""\\', colors.snow)
  paint(36, 3, '"""', colors.snow, colors.snowBg)
  paint(33, 4, `/${'"'.repeat(7)}\\`, colors.snow)
  paint(34, 4, '"'.repeat(7), colors.snow, colors.snowBg)
  paint(31, 5, `/${'"'.repeat(11)}\\`, colors.snow)
  paint(32, 5, '"'.repeat(11), colors.snow, colors.snowBg)
  paint(37, 4, "*", colors.light, colors.snowBg)
  paint(34, 5, "*", colors.light, colors.snowBg)
  paint(29, 6, `/${" ".repeat(15)}\\`, colors.mountain)
  paint(30, 6, " ".repeat(15), colors.mountain, colors.mountainBg)
  paint(30, 6, '"'.repeat(5), colors.snow, colors.snowBg)
  paint(40, 6, '"'.repeat(5), colors.snow, colors.snowBg)
  paint(27, 7, `/${" ".repeat(19)}\\`, colors.mountain)
  paint(28, 7, " ".repeat(19), colors.mountain, colors.mountainBg)
  paint(23, 8, `/${" ".repeat(27)}\\`, colors.mountain)
  paint(24, 8, " ".repeat(27), colors.mountain, colors.mountainBg)
  paint(14, 9, `/${" ".repeat(46)}\\`, colors.mountain)
  paint(15, 9, " ".repeat(46), colors.mountain, colors.mountainBg)
  paint(0, 9, "_".repeat(14), colors.mountain)
  paint(62, 9, "_".repeat(12), colors.mountain)
  // Water with a sun/moon reflection column under the orb.
  paint(0, 10, "~".repeat(SCENE_WIDTH), colors.water, colors.waterBg)
  paint(0, 11, "~".repeat(SCENE_WIDTH), colors.water, colors.waterDeep)
  const reflectionX = night ? 54 : 35
  paint(reflectionX, 10, "~~~~~", colors.light, colors.orbBg)
  paint(reflectionX, 11, "~~~~~", colors.light, colors.orbBg)
  // One sakura on each shore.
  paint(3, 12, "(        )", colors.blossom)
  paint(4, 12, "        ", colors.blossom, colors.blossomBg)
  paint(61, 12, "(        )", colors.blossom)
  paint(62, 12, "        ", colors.blossom, colors.blossomBg)
  paint(7, 13, "||", colors.trunk)
  paint(65, 13, "||", colors.trunk)
  paint(0, 14, "_".repeat(SCENE_WIDTH), colors.track)
  paint(0, 15, "=".repeat(SCENE_WIDTH), colors.track)
  // Petals drift in front of the scenery. They keep the cell background so
  // they never punch holes in the mountain, water, or blossom fills.
  for (const petal of fujiPetals(elapsedMs)) {
    const row = top + petal.y
    if (row < 0 || row >= height) continue
    const column = left + petal.x
    if (petal.x < 0 || petal.x >= SCENE_WIDTH || column < 0 || column >= width) continue
    const cell = grid[row]![column]!
    grid[row]![column] = { text: petal.char, color: colors.petal, background: cell.background }
  }
  // Elapsed-time traversal: the train enters from the right and exits left.
  const trainX = fujiTrainX(elapsedMs)
  paint(trainX, 16, TRAIN[0]!, colors.train, colors.trainBg)
  paint(trainX, 17, TRAIN[1]!, colors.train, colors.trainBg)
  paint(trainX + TRAIN_JR_OFFSET, 17, "JR", colors.jr, colors.trainBg)
  paint(trainX, 18, TRAIN[2]!, colors.skirt, colors.trainBg)
  // Undercarriage shadow with wheels, travelling with the train.
  paint(trainX, 19, " ".repeat(TRAIN_WIDTH), colors.wheel, colors.underBg)
  for (const offset of TRAIN_WHEEL_OFFSETS) paint(trainX + offset, 19, "(O)", colors.wheel, colors.underBg)
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
