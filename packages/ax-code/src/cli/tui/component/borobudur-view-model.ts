import type { FujiRun } from "./fuji-view-model"

export type BorobudurStyle = "borobudur-mist" | "borobudur-noon"
export function isBorobudurStyle(style: string | undefined): style is BorobudurStyle {
  return style === "borobudur-mist" || style === "borobudur-noon"
}

/** Reference composition size shared by both renderers. */
export const BOROBUDUR_COLUMNS = 76
export const BOROBUDUR_ROWS = 24
/** Three stepped tiers, bottom-up: each entry is [x0, x1, y0, y1]. */
export const BOROBUDUR_TIERS = [
  [14, 61, 13, 15],
  [22, 53, 10, 12],
  [30, 45, 7, 9],
] as const
export const BOROBUDUR_STUPA = { x: 38, top: 3, base: 6 } as const
export const BOROBUDUR_GROUND_TOP = 18
export const BOROBUDUR_MIST_BANDS = [6, 10, 14] as const
/** Flanking palm trunks. */
export const BOROBUDUR_PALMS = [7, 68] as const
/** Merapi volcano silhouette on the left horizon. */
export const BOROBUDUR_VOLCANO = { x: 6, top: 9, base: 11 } as const
export const BOROBUDUR_SUN = { x: 64, y: 2 } as const
/** Pilgrims climbing the lowest terrace. */
export const BOROBUDUR_PILGRIMS = [20, 32, 44, 56] as const
/** Flower offerings along the upper terrace. */
export const BOROBUDUR_OFFERINGS = [33, 36, 40, 43] as const

/** Palette shared by the text and pixel renderers. */
export const BOROBUDUR_COLORS = {
  "borobudur-mist": {
    sky: "#a8b4b8",
    skyBottom: "#d8dcd2",
    stone: "#7a7268",
    stoneDark: "#4e4840",
    stupa: "#8a8278",
    relief: "#5e574e",
    buddha: "#3e382f",
    palms: "#3e5a3a",
    bird: "#4a5058",
    mist: "#e8ece8",
    leaf: "#5a7a52",
    ground: "#4a5a42",
    volcano: "#6a7078",
    sun: "#f2ecd8",
    pilgrim: "#4a3a30",
    offer: "#e8a8bc",
  },
  "borobudur-noon": {
    sky: "#6aaed6",
    skyBottom: "#f2ecd8",
    stone: "#9a8a72",
    stoneDark: "#5e5240",
    stupa: "#b0a088",
    relief: "#7a6a50",
    buddha: "#4e4232",
    palms: "#2a5a2a",
    bird: "#3a4a5a",
    mist: "#f7f3e8",
    leaf: "#3d7a3d",
    ground: "#55683e",
    volcano: "#5a6a7a",
    sun: "#ffd98a",
    pilgrim: "#5e4a36",
    offer: "#d86a8a",
  },
} as const satisfies Record<BorobudurStyle, Record<string, string>>

export function borobudurBackground(style: BorobudurStyle) {
  return style === "borobudur-mist" ? "#b4bcbc" : "#7ec0e4"
}

/** Sample the vertical sky gradient. `t` is 0 at the top of the frame. */
export function borobudurSkyRgb(style: BorobudurStyle, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(borobudurBackground(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(BOROBUDUR_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

/** Mist band drift offset on a 4800ms round. */
export function borobudurDrift(elapsedMs: number): number {
  return Math.floor((Math.max(0, elapsedMs) % 4800) / 200)
}

export type BorobudurBird = { x: number; y: number }
/** Two swifts crossing the sky in opposite directions. */
export function borobudurBirds(elapsedMs: number): BorobudurBird[] {
  const t = Math.max(0, elapsedMs)
  return [
    { x: (10 + Math.floor(t / 300)) % BOROBUDUR_COLUMNS, y: 6 },
    {
      x: ((60 - Math.floor(t / 400) + BOROBUDUR_COLUMNS) % BOROBUDUR_COLUMNS + BOROBUDUR_COLUMNS) % BOROBUDUR_COLUMNS,
      y: 4,
    },
  ]
}

export function borobudurRows(columns: number, rows: number, style: BorobudurStyle, elapsedMs: number): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const misty = style === "borobudur-mist"
  const colors = BOROBUDUR_COLORS[style]
  const drift = borobudurDrift(elapsedMs)
  const grid: FujiRun[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: colors.sky })),
  )
  const left = Math.floor((width - BOROBUDUR_COLUMNS) / 2),
    top = Math.floor((height - BOROBUDUR_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + Math.round(y)
    if (row < 0 || row >= height) return
    for (let i = 0; i < text.length; i++) {
      const sceneX = Math.round(x) + i
      const column = left + sceneX
      if (sceneX < 0 || sceneX >= BOROBUDUR_COLUMNS || column < 0 || column >= width) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }
  // Pale sun over the valley.
  paint(BOROBUDUR_SUN.x - 1, BOROBUDUR_SUN.y - 1, ".-.", colors.sun)
  paint(BOROBUDUR_SUN.x - 2, BOROBUDUR_SUN.y, "(   )", colors.sun)
  // Merapi volcano on the left horizon.
  const crater = BOROBUDUR_VOLCANO
  paint(crater.x - 1, crater.top, "/\\", colors.volcano)
  paint(crater.x - 2, crater.top + 1, "/--\\", colors.volcano)
  paint(crater.x - 3, crater.top + 2, "/----\\", colors.volcano)
  // Central stupa over stepped tiers ringed with small stupas.
  const stupa = BOROBUDUR_STUPA
  paint(stupa.x - 1, stupa.top, ".", colors.stupa)
  paint(stupa.x - 2, stupa.top + 1, "(   )", colors.stoneDark, colors.stupa)
  paint(stupa.x - 2, stupa.top + 2, "(   )", colors.stoneDark, colors.stupa)
  paint(38, 4, "&", colors.buddha, colors.stupa)
  paint(stupa.x - 3, stupa.base, "=".repeat(7), colors.stoneDark)
  for (const [x0, x1, y0, y1] of BOROBUDUR_TIERS) {
    for (let y = y0; y <= y1; y++) {
      paint(x0, y, "[" + " ".repeat(x1 - x0 - 1) + "]", colors.stoneDark, colors.stone)
    }
    for (let x = x0 + 3; x <= x1 - 3; x += 6) {
      paint(x, y0 - 1, "n", colors.stoneDark, colors.stupa)
    }
  }
  // Carved relief frieze across the lowest terrace.
  for (let x = 16; x <= 60; x += 5) {
    paint(x, 14, "o", colors.relief, colors.stone)
  }
  // Flower offerings along the upper terrace.
  for (const offer of BOROBUDUR_OFFERINGS) {
    paint(offer, 7, "*", colors.offer, colors.stone)
  }
  // Jungle tufts at the foot, two rows deep.
  for (let x = 4; x < BOROBUDUR_COLUMNS; x += 9) {
    paint(x, BOROBUDUR_GROUND_TOP - 1, "/|\\", colors.leaf)
  }
  for (let x = 8; x < BOROBUDUR_COLUMNS; x += 9) {
    paint(x, BOROBUDUR_GROUND_TOP - 2, "/|\\", colors.leaf)
  }
  // Pilgrims climbing the lowest terrace.
  for (const pilgrim of BOROBUDUR_PILGRIMS) {
    paint(pilgrim, 12, "o", colors.pilgrim)
  }
  // Flanking palms lean over the terraces.
  paint(4, 12, "\\|/", colors.palms)
  paint(8, 12, "\\|/", colors.palms)
  paint(7, 13, "|", colors.palms)
  paint(7, 14, "|", colors.palms)
  paint(7, 15, "/", colors.palms)
  paint(6, 16, "/", colors.palms)
  paint(66, 12, "\\|/", colors.palms)
  paint(70, 12, "\\|/", colors.palms)
  paint(68, 13, "|", colors.palms)
  paint(68, 14, "|", colors.palms)
  paint(68, 15, "\\", colors.palms)
  paint(69, 16, "\\", colors.palms)
  // Mist veils the tiers when misty and thins to a wisp at noon.
  const bands = misty ? BOROBUDUR_MIST_BANDS : [BOROBUDUR_MIST_BANDS[1]!]
  for (const band of bands) {
    for (let x = 0; x < BOROBUDUR_COLUMNS; x += 8) {
      const offset = (x + drift) % BOROBUDUR_COLUMNS
      paint(offset, band, misty ? "~~~~~~" : "~~~ ~~", colors.mist)
    }
  }
  // Swifts cross above the mist.
  for (const bird of borobudurBirds(elapsedMs)) {
    paint(bird.x, bird.y, "v", colors.bird)
  }
  for (let y = BOROBUDUR_GROUND_TOP; y < BOROBUDUR_ROWS; y++) {
    paint(0, y, " ".repeat(BOROBUDUR_COLUMNS), colors.ground, colors.ground)
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
