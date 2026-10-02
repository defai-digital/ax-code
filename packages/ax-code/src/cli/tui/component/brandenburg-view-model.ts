import type { FujiRun } from "./fuji-view-model"

export type BrandenburgStyle = "brandenburg-night" | "brandenburg-dawn"
export function isBrandenburgStyle(style: string | undefined): style is BrandenburgStyle {
  return style === "brandenburg-night" || style === "brandenburg-dawn"
}

/** Reference composition size shared by both renderers. */
export const BRANDENBURG_COLUMNS = 76
export const BRANDENBURG_ROWS = 24
/** First ground row; the plaza fills everything below it. */
export const BRANDENBURG_GROUND_TOP = 19
/** Scene column of the gate center. */
export const BRANDENBURG_CENTER_X = 38

/**
 * Gate geometry in gate units: x is measured from the gate center and y up
 * from the ground line. One unit is one scene column wide and half a scene
 * row tall, so cells (twice as tall as wide) stay square. Proportions follow
 * the real gate: six Doric columns, walled outer passages, a frieze under a
 * projecting cornice, a stepped attic, and the quadriga on a central block.
 */
export const BRANDENBURG_GATE = {
  /** Front column centers, left to right. */
  columns: [-21.4, -13.2, -5.1, 5.1, 13.2, 21.4],
  shaftHalf: 1.55,
  capitalHalf: 2.05,
  plinthTop: 0.8,
  capitalBottom: 17.5,
  architraveBottom: 18.4,
  friezeBottom: 19.8,
  corniceBottom: 22.2,
  atticBottom: 23.4,
  atticTop: 26.4,
  centerAtticTop: 27.6,
  /** Cornice overhang and body half widths. */
  corniceHalf: 24.4,
  bodyHalf: 23.2,
  atticHalf: 22.4,
  centerAtticHalf: 6.9,
  /** Walled outer passages sit between the outer and middle columns. */
  wallHalfSpan: [14.8, 19.8],
  /** Open passages: [inner edge, outer edge] of the side openings; the center opening is +-3.55. */
  openings: [
    [6.65, 11.65],
    [-11.65, -6.65],
  ],
  centerOpeningHalf: 3.55,
  /** Soffit under the architrave, lit from below. */
  soffitBottom: 15.4,
  /** Back-row column slabs glimpsed inside the openings. */
  backSlabs: [-10, -3.5, 3.5, 10],
  /** Colonnade wings: roof, cornice, and spacing, in gate units. */
  wingInner: 22.5,
  wingColumnPitch: 2.4,
  wingRoofTop: 14.6,
  wingColumnTop: 11.5,
  quadrigaTop: 36.4,
} as const

/** Night stars in scene cells, kept clear of the gate. */
export const BRANDENBURG_STARS = [
  { x: 3, y: 1 },
  { x: 8, y: 0 },
  { x: 11, y: 4 },
  { x: 24, y: 2 },
  { x: 52, y: 1 },
  { x: 64, y: 5 },
  { x: 66, y: 1 },
  { x: 71, y: 3 },
] as const

/** Palette shared by the text and pixel renderers. */
export const BRANDENBURG_COLORS = {
  "brandenburg-night": {
    sky: "#8ba0c8",
    skyBottom: "#6a86c9",
    sandHi: "#f7dc92",
    sand: "#dcb66a",
    sandLo: "#9a7440",
    sandDeep: "#5a4226",
    soffit: "#ffe39a",
    wall: "#ebc67c",
    roof: "#222b48",
    bronze: "#6a8748",
    bronzeHi: "#a9ba6c",
    bronzeLo: "#2f4a2c",
    interior: "#4a3220",
    lamp: "#ffb347",
    tree: "#0b1c1a",
    ground: "#4a5068",
    groundBottom: "#222637",
    glow: "#c9a561",
    star: "#e8ecff",
    bird: "#7f98cc",
    walker: "#10141f",
  },
  "brandenburg-dawn": {
    sky: "#9db8d8",
    skyBottom: "#ffd9a6",
    sandHi: "#f9ebc6",
    sand: "#e2c78f",
    sandLo: "#ab9064",
    sandDeep: "#6e5a40",
    soffit: "#f6dca0",
    wall: "#ecd5a4",
    roof: "#4a5370",
    bronze: "#86a25e",
    bronzeHi: "#d2dc98",
    bronzeLo: "#3a5532",
    interior: "#47352a",
    lamp: "#ffd08a",
    tree: "#1c3a2a",
    ground: "#8c8678",
    groundBottom: "#5e5a56",
    glow: "#e6c98f",
    star: "#fff3d6",
    bird: "#3a4a6a",
    walker: "#2a2c36",
  },
} as const satisfies Record<BrandenburgStyle, Record<string, string>>

export function brandenburgBackground(style: BrandenburgStyle) {
  return style === "brandenburg-night" ? "#06175a" : "#4f72ba"
}

/** Sample the sky gradient. `t` is 0 at the top of the frame and 1 at the horizon. */
export function brandenburgSkyRgb(style: BrandenburgStyle, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(brandenburgBackground(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(BRANDENBURG_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

/** Floodlight level 0..1: the night opening switches the lights on, dawn starts nearly lit. */
export function brandenburgLights(style: BrandenburgStyle, elapsedMs: number): number {
  const t = Math.max(0, Math.min(1, elapsedMs / 1400))
  const eased = t * t * (3 - 2 * t)
  const start = style === "brandenburg-night" ? 0.35 : 0.8
  return start + (1 - start) * eased
}

/** Sun height above the ground line in gate units; it climbs behind the gate over the dawn ending. */
export function brandenburgSun(elapsedMs: number): number {
  const t = Math.max(0, Math.min(1, elapsedMs / 3500))
  return 2.5 + 6.5 * (t * t * (3 - 2 * t))
}

/** Star twinkle phase: every star shines two of three 400ms beats. */
export function brandenburgStarBright(elapsedMs: number, index: number): boolean {
  return (Math.floor(Math.max(0, elapsedMs) / 400) + index) % 3 !== 0
}

export type BrandenburgBird = { x: number; y: number; up: boolean }
/** Birds crossing the dusk sky with a wing-beat every 300ms. */
export function brandenburgBirds(elapsedMs: number): BrandenburgBird[] {
  const t = Math.max(0, elapsedMs)
  const up = Math.floor(t / 300) % 2 === 0
  return [
    { x: -6 + ((t * 0.012 + 4) % (BRANDENBURG_COLUMNS + 12)), y: 3, up },
    { x: -6 + ((t * 0.01 + 38) % (BRANDENBURG_COLUMNS + 12)), y: 1, up: !up },
    { x: -6 + ((t * 0.014 + 62) % (BRANDENBURG_COLUMNS + 12)), y: 4, up },
  ]
}

export type BrandenburgWalker = { x: number; depth: number; height: number }
const WALKERS = [
  { x: 14, depth: 0, dir: 1 },
  { x: 22, depth: 1, dir: -1 },
  { x: 30, depth: 0, dir: 1 },
  { x: 36, depth: 2, dir: -1 },
  { x: 41, depth: 0, dir: -1 },
  { x: 47, depth: 1, dir: 1 },
  { x: 56, depth: 2, dir: 1 },
  { x: 63, depth: 0, dir: -1 },
] as const
/** Pedestrians strolling across the plaza. `depth` 0 stands near the gate, 2 is closest to the viewer. */
export function brandenburgWalkers(elapsedMs: number): BrandenburgWalker[] {
  const t = Math.max(0, elapsedMs) / 1000
  return WALKERS.map((walker) => {
    const span = BRANDENBURG_COLUMNS - 8
    const x = (((walker.x - 4 + walker.dir * t * 0.9) % span) + span) % span
    return { x: x + 4, depth: walker.depth, height: 3 + walker.depth * 0.9 }
  })
}

export function brandenburgRows(
  columns: number,
  rows: number,
  style: BrandenburgStyle,
  elapsedMs: number,
): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const night = style === "brandenburg-night"
  const colors = BRANDENBURG_COLORS[style]
  const gate = BRANDENBURG_GATE
  const lit = brandenburgLights(style, elapsedMs) > 0.7
  const grid: FujiRun[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: colors.sky })),
  )
  const left = Math.floor((width - BRANDENBURG_COLUMNS) / 2),
    top = Math.floor((height - BRANDENBURG_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + Math.round(y)
    if (row < 0 || row >= height) return
    for (let i = 0; i < text.length; i++) {
      const sceneX = Math.round(x) + i
      const column = left + sceneX
      if (sceneX < 0 || sceneX >= BRANDENBURG_COLUMNS || column < 0 || column >= width) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }
  /** Gate-unit x to a scene column and gate-unit y to a scene row. */
  const col = (gx: number) => Math.round(BRANDENBURG_CENTER_X + gx)
  const row = (gy: number) => Math.floor(BRANDENBURG_GROUND_TOP - gy / 2)
  const block = (gx0: number, gx1: number, gy0: number, gy1: number, text: string, color: string, bg: string) => {
    const a = col(Math.min(gx0, gx1))
    const b = col(Math.max(gx0, gx1))
    for (let y = row(gy1); y <= row(gy0 + 0.01); y++) {
      paint(a, y, text.repeat(Math.max(0, b - a + 1)), color, bg)
    }
  }

  if (night) {
    BRANDENBURG_STARS.forEach((star, i) => {
      paint(star.x, star.y, brandenburgStarBright(elapsedMs, i) ? "*" : ".", colors.star)
    })
  } else {
    // Sun climbing behind the gate, seen through the central opening.
    const sunRow = row(brandenburgSun(elapsedMs))
    paint(BRANDENBURG_CENTER_X - 2, sunRow - 1, "_O_", colors.soffit)
    paint(BRANDENBURG_CENTER_X - 3, sunRow, "(   )", colors.soffit)
  }
  for (const bird of brandenburgBirds(elapsedMs)) {
    paint(bird.x, bird.y, bird.up ? "v" : "^", colors.bird)
  }

  // Tiergarten tree line behind everything.
  for (let x = 0; x < BRANDENBURG_COLUMNS; x += 4) {
    const center = Math.abs(x - BRANDENBURG_CENTER_X) < 5
    const crown = center ? 3 : 2 + ((x * 7) % 3)
    for (let y = BRANDENBURG_GROUND_TOP - crown - 1; y < BRANDENBURG_GROUND_TOP; y++) {
      paint(x, y, "&@&", colors.tree)
    }
  }
  // Street lights down the avenue behind the gate.
  for (const gx of [-3, -1.5, 0, 1.5, 3]) {
    paint(col(gx), BRANDENBURG_GROUND_TOP - 2, night ? "." : ",", colors.lamp)
  }

  // Colonnade wings flank the gate and run to the screen edge.
  for (const side of [-1, 1]) {
    const edge = side * (BRANDENBURG_COLUMNS / 2 + 2)
    const inner = side * gate.wingInner
    block(Math.min(inner, edge), Math.max(inner, edge), 12, 13.4, "=", colors.sandLo, colors.sand)
    block(Math.min(inner, edge), Math.max(inner, edge), 0.5, 11.5, " ", colors.interior, colors.interior)
    for (let gx = inner + side * 1.2; Math.abs(gx) < BRANDENBURG_COLUMNS / 2 + 1; gx += side * 3) {
      block(gx - 0.5, gx + 0.5, 0.5, 11.5, "|", colors.sandLo, colors.sand)
    }
    paint(col(side * 28), row(9), night && lit ? "*" : ".", colors.lamp)
  }

  // Quadriga with Victory and the eagle on the central attic.
  paint(BRANDENBURG_CENTER_X - 1, 0, "\\v/", colors.bronzeHi)
  paint(BRANDENBURG_CENTER_X - 1, 1, "(|)", colors.bronze)
  paint(BRANDENBURG_CENTER_X - 4, 2, "n n Y n n", colors.bronze)
  paint(BRANDENBURG_CENTER_X - 5, 3, "HHHHHHHHH", colors.bronzeLo, colors.bronze)
  paint(BRANDENBURG_CENTER_X - 5, 4, "=========", colors.sandLo, colors.sand)

  // Attic, steps, and the relief block under the quadriga.
  block(-gate.atticHalf, gate.atticHalf, gate.atticBottom, gate.atticTop, " ", colors.sandLo, colors.sand)
  for (const side of [-1, 1]) {
    for (let step = 0; step < 4; step++) {
      const x0 = side * (gate.centerAtticHalf + 0.5 + step * 2)
      paint(Math.min(col(x0), col(x0 + side * 1.8)), 6 - (step > 1 ? 0 : 0), "_", colors.sandHi, colors.sand)
    }
  }
  block(
    -gate.centerAtticHalf,
    gate.centerAtticHalf,
    gate.atticBottom,
    gate.centerAtticTop,
    ":",
    colors.sandLo,
    colors.sandHi,
  )
  // Cornice, frieze, and architrave take one row each.
  const bandLeft = col(-gate.corniceHalf)
  paint(bandLeft, 7, "=".repeat(col(gate.corniceHalf) - bandLeft + 1), colors.sandDeep, colors.sandHi)
  const bodyLeft = col(-gate.bodyHalf)
  const bodyWidth = col(gate.bodyHalf) - bodyLeft + 1
  paint(bodyLeft, 8, " ".repeat(bodyWidth), colors.sandLo, colors.sand)
  for (let gx = -gate.bodyHalf; gx < gate.bodyHalf; gx += 3.3) {
    paint(col(gx), 8, "|", colors.sandLo, colors.sand)
    paint(col(gx + 1.6), 8, "o", colors.sandHi, colors.sand)
  }
  paint(bodyLeft, 9, "-".repeat(bodyWidth), colors.sandDeep, colors.sand)

  // Lit soffit across the passages and glimpsed back columns.
  for (const [a, b] of [[-gate.openings[0]![1], gate.openings[0]![1]]] as const) {
    block(a, b, gate.soffitBottom, gate.architraveBottom - 0.01, " ", colors.sandLo, colors.soffit)
  }
  for (const gx of gate.backSlabs) {
    block(gx - 0.4, gx + 0.4, gate.plinthTop, gate.soffitBottom - 0.01, "|", colors.sandLo, colors.sandLo)
  }

  // Walled outer passages carry a medallion and a relief panel.
  for (const side of [-1, 1]) {
    const [near, far] = gate.wallHalfSpan
    block(side * near, side * far, 0.5, gate.architraveBottom - 0.01, " ", colors.sandLo, colors.wall)
    paint(col(side * 17.4) - 1, row(14), "(o)", colors.sandLo, colors.wall)
    paint(col(side * 17.4) - 1, row(10.2), "===", colors.sandLo, colors.wall)
  }

  // Six fluted columns: capital, shaft, and plinth.
  for (const gx of gate.columns) {
    paint(col(gx) - 2, row(gate.capitalBottom + 0.9), "[===]", colors.sandDeep, colors.sandHi)
    for (let y = row(gate.capitalBottom); y <= row(gate.plinthTop); y++) {
      paint(col(gx) - 1, y, "|||", colors.sandLo, colors.sand)
    }
    paint(col(gx) - 2, BRANDENBURG_GROUND_TOP - 1, "=====", colors.sandDeep, colors.sandLo)
  }

  // Plaza, floor spotlights, and strollers.
  for (let y = BRANDENBURG_GROUND_TOP; y < BRANDENBURG_ROWS; y++) {
    paint(0, y, " ".repeat(BRANDENBURG_COLUMNS), colors.ground, colors.ground)
  }
  for (let x = 0; x < BRANDENBURG_COLUMNS; x += 3) {
    paint(x, BRANDENBURG_GROUND_TOP + 1, ".", colors.groundBottom, colors.ground)
    paint(x + 1, BRANDENBURG_GROUND_TOP + 3, ".", colors.groundBottom, colors.ground)
  }
  for (const gx of gate.columns) {
    paint(col(gx), BRANDENBURG_GROUND_TOP, night ? "*" : ".", colors.soffit, colors.ground)
  }
  for (const walker of brandenburgWalkers(elapsedMs)) {
    const base = BRANDENBURG_GROUND_TOP + (walker.depth > 0 ? 1 : 0)
    paint(walker.x, base - 1, "o", colors.walker, walker.depth > 0 ? colors.ground : undefined)
    paint(walker.x, base, "|", colors.walker, colors.ground)
  }
  return grid.map((line) => {
    const runs: FujiRun[] = []
    for (const cell of line) {
      const last = runs.at(-1)
      if (last?.color === cell.color && last.background === cell.background) last.text += cell.text
      else runs.push({ ...cell })
    }
    return runs
  })
}
