import type { FujiRun } from "./fuji-view-model"
import { createSceneGrid } from "./scene-grid"

export type DinosaurStyle = "dinosaur-day" | "dinosaur-night"
export function isDinosaurStyle(style: string | undefined): style is DinosaurStyle {
  return style === "dinosaur-day" || style === "dinosaur-night"
}

/** Reference composition size shared by both renderers. */
export const DINOSAUR_COLUMNS = 76
export const DINOSAUR_ROWS = 24
export const DINOSAUR_GROUND_TOP = 18
export const DINOSAUR_SUN = { x: 62, y: 2 } as const
export const DINOSAUR_MOON = { x: 12, y: 2 } as const
/** Night stars in row-major order, shared by both renderers. */
export const DINOSAUR_STARS = [
  { x: 9, y: 1 },
  { x: 20, y: 3 },
  { x: 33, y: 0 },
  { x: 45, y: 2 },
  { x: 55, y: 5 },
  { x: 70, y: 1 },
] as const
/** Distant volcano smoking over the valley's right shoulder. */
export const DINOSAUR_VOLCANO = { x: 62, top: 6, base: 12 } as const
/** Sauropod anchor: sprite painted from this top-left corner. */
export const DINOSAUR_SAUROPOD = { x: 6, top: 7 } as const
/** Egg nest in the right foreground. */
export const DINOSAUR_NEST = { x: 58, y: 21 } as const
export const DINOSAUR_CYCLE_MS = 3600

/** Palette shared by the text and pixel renderers. */
export const DINOSAUR_COLORS = {
  "dinosaur-day": {
    sky: "#7ab5d3",
    skyBottom: "#d8ecd2",
    sun: "#ffdf6a",
    hill: "#6a9a52",
    hillFar: "#93ba77",
    volcano: "#7a6a5e",
    lava: "#e85a24",
    smoke: "#c8ccd0",
    fern: "#2e6b2e",
    trunk: "#5e4630",
    ground: "#5d8a3c",
    groundDark: "#3f6527",
    dino: "#33512f",
    dinoBg: "#7a9a5e",
    belly: "#c9bd8a",
    eye: "#16210f",
    ptero: "#2c3e35",
    footprint: "#33541f",
    egg: "#efe6c8",
    firefly: "#ffdf6a",
  },
  "dinosaur-night": {
    sky: "#8ba0c8",
    skyBottom: "#2c4a3a",
    sun: "#ffdf6a",
    hill: "#1e3325",
    hillFar: "#2a4232",
    volcano: "#2e2a26",
    lava: "#ff7a33",
    smoke: "#5a6470",
    fern: "#14291b",
    trunk: "#241a12",
    ground: "#1c3320",
    groundDark: "#12221a",
    dino: "#aebba4",
    dinoBg: "#243526",
    belly: "#4a4a38",
    eye: "#ffb14e",
    ptero: "#c2cbd2",
    footprint: "#0e1c12",
    egg: "#b7ad8d",
    firefly: "#ffe98a",
  },
} as const satisfies Record<DinosaurStyle, Record<string, string>>

export function dinosaurBackground(style: DinosaurStyle) {
  return style === "dinosaur-day" ? "#8ec8e8" : "#0c1626"
}

/** Sample the vertical sky gradient. `t` is 0 at the top of the frame. */
export function dinosaurSkyRgb(style: DinosaurStyle, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(dinosaurBackground(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(DINOSAUR_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

/** 300ms valley beat looping bit-identically with the 3600ms cycle. */
export function dinosaurTick(elapsedMs: number): number {
  return Math.floor(Math.max(0, elapsedMs) / 300) % 12
}

export type DinosaurPtero = { x: number; y: number }
/** Pterosaur gliding east across the sky, riding a slow thermal. */
export function dinosaurPtero(elapsedMs: number): DinosaurPtero {
  const phase = (Math.max(0, elapsedMs) % DINOSAUR_CYCLE_MS) / DINOSAUR_CYCLE_MS
  return {
    x: Math.floor(phase * DINOSAUR_COLUMNS) % DINOSAUR_COLUMNS,
    y: 3 + Math.round(Math.sin(2 * Math.PI * phase) * 1.5),
  }
}

export type DinosaurWalker = { x: number; y: number }
/** Baby dinosaur toddling west across the foreground, against the sky traffic. */
export function dinosaurWalker(elapsedMs: number): DinosaurWalker {
  const phase = (Math.max(0, elapsedMs) % DINOSAUR_CYCLE_MS) / DINOSAUR_CYCLE_MS
  return { x: DINOSAUR_COLUMNS - 8 - Math.floor(phase * (DINOSAUR_COLUMNS - 16)), y: 20 }
}

/** Side-view sauropod sprite, 38 columns wide, painted from DINOSAUR_SAUROPOD. */
export const DINOSAUR_SAUROPOD_LINES = [
  "              /\\                     ",
  "             (o )                    ",
  "              \\ \\                    ",
  "               \\ \\                   ",
  "                \\ \\__                ",
  "         .-~~~--_____---.            ",
  "       .'                '-_         ",
  "      /                      ~--__   ",
  "     |                            ~~ ",
  "      \\__  ___  ___  ___  __/        ",
  "        ||  ||  ||  ||  ||           ",
  "        ||  ||  ||  ||  ||           ",
] as const

export function dinosaurRows(width: number, height: number, style: DinosaurStyle, elapsedMs: number): FujiRun[][] {
  const night = style === "dinosaur-night"
  const colors = DINOSAUR_COLORS[style]
  const tick = dinosaurTick(elapsedMs)
  const { paint, merge } = createSceneGrid({
    columns: width,
    rows: height,
    sceneColumns: DINOSAUR_COLUMNS,
    sceneRows: DINOSAUR_ROWS,
    sky: colors.sky,
  })
  if (night) {
    DINOSAUR_STARS.forEach((star, i) => {
      paint(star.x, star.y, (Math.floor(Math.max(0, elapsedMs) / 600) + i) % 3 === 0 ? "*" : ".", colors.sky)
    })
    paint(DINOSAUR_MOON.x - 1, DINOSAUR_MOON.y - 1, ".-.", colors.egg)
    paint(DINOSAUR_MOON.x - 2, DINOSAUR_MOON.y, "(   )", colors.egg)
  } else {
    paint(DINOSAUR_SUN.x - 1, DINOSAUR_SUN.y - 1, "\\|/", colors.sun)
    paint(DINOSAUR_SUN.x - 1, DINOSAUR_SUN.y, "-o-", colors.sun)
    paint(DINOSAUR_SUN.x - 1, DINOSAUR_SUN.y + 1, "/|\\", colors.sun)
  }
  // Distant hills, then the smoking volcano on the right shoulder.
  paint(2, 9, "/^^^\\", colors.hillFar)
  paint(24, 8, "/^^\\", colors.hillFar)
  for (let y = 10; y < DINOSAUR_GROUND_TOP - 4; y++) {
    paint(0, y, " ".repeat(10 - (y - 10)), colors.hill, colors.hill)
  }
  paint(DINOSAUR_VOLCANO.x - 1, DINOSAUR_VOLCANO.top, "/==\\", colors.volcano)
  paint(DINOSAUR_VOLCANO.x, DINOSAUR_VOLCANO.top, "*", colors.lava)
  paint(DINOSAUR_VOLCANO.x - 3, DINOSAUR_VOLCANO.top + 2, "/      \\", colors.volcano)
  paint(DINOSAUR_VOLCANO.x - 5, DINOSAUR_VOLCANO.top + 4, "/          \\", colors.volcano)
  // Smoke puffs drift on the valley beat.
  paint(DINOSAUR_VOLCANO.x + (tick % 3), DINOSAUR_VOLCANO.top - 2, "o", colors.smoke)
  paint(DINOSAUR_VOLCANO.x + 2 + (tick % 2), DINOSAUR_VOLCANO.top - 4, ".", colors.smoke)
  // Ground with a footprint trail crossing the foreground.
  for (let y = DINOSAUR_GROUND_TOP; y < DINOSAUR_ROWS; y++) {
    paint(0, y, " ".repeat(DINOSAUR_COLUMNS), colors.groundDark, colors.ground)
  }
  for (let i = 0; i < 6; i++) {
    paint(6 + i * 11, 22 + (i % 2), "()", colors.footprint, colors.ground)
  }
  // Fern trees framing both edges, fronds swaying on the beat.
  for (const fx of [2, DINOSAUR_COLUMNS - 5]) {
    for (let y = 13; y < DINOSAUR_GROUND_TOP + 1; y++) paint(fx + 1, y, "|", colors.trunk)
    paint(fx - 1, 12, tick % 2 === 0 ? "\\|/" : "/|\\", colors.fern)
    paint(fx - 1, 13, "-Y-", colors.fern)
  }
  paint(46, 16, "Y", colors.fern, colors.ground)
  paint(52, 17, "Y", colors.fern, colors.ground)
  // The sauropod grazes center-stage; its eye glows after dark.
  DINOSAUR_SAUROPOD_LINES.forEach((line, i) => {
    paint(DINOSAUR_SAUROPOD.x, DINOSAUR_SAUROPOD.top + i, line, colors.dino, i >= 5 ? colors.dinoBg : undefined)
  })
  paint(DINOSAUR_SAUROPOD.x + 14, DINOSAUR_SAUROPOD.top + 1, night ? "*" : "o", colors.eye)
  // Pterosaur overhead, baby dinosaur toddling through the foreground.
  const ptero = dinosaurPtero(elapsedMs)
  paint(ptero.x, ptero.y, tick % 2 === 0 ? "/v\\" : "\\v/", colors.ptero)
  const walker = dinosaurWalker(elapsedMs)
  paint(walker.x, walker.y, " /\\", colors.dino, colors.ground)
  paint(walker.x, walker.y + 1, "(__\\", colors.dino, colors.ground)
  paint(walker.x, walker.y + 2, tick % 2 === 0 ? " ||" : " |/", colors.dino, colors.ground)
  // Egg nest: quiet by day, one egg rocking after dark.
  paint(DINOSAUR_NEST.x, DINOSAUR_NEST.y, "(o o o)", colors.egg, colors.ground)
  paint(DINOSAUR_NEST.x, DINOSAUR_NEST.y + 1, "\\_____/", colors.trunk, colors.ground)
  if (night) {
    paint(DINOSAUR_NEST.x + 3, DINOSAUR_NEST.y - 1, tick % 2 === 0 ? "*" : ".", colors.firefly, colors.ground)
    // Fireflies over the sleeping valley.
    paint(20 + (tick % 5), 16, "*", colors.firefly)
    paint(48 - (tick % 4), 15, "*", colors.firefly)
  }
  return merge()
}
