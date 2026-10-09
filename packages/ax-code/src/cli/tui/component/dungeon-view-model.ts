import type { FujiRun } from "./fuji-view-model"

export type DungeonStyle = "dungeon-descent" | "dungeon-treasure"
export function isDungeonStyle(style: string | undefined): style is DungeonStyle {
  return style === "dungeon-descent" || style === "dungeon-treasure"
}

/** Reference composition size shared by both renderers. */
export const DUNGEON_COLUMNS = 76
export const DUNGEON_ROWS = 24
export const DUNGEON_STEP_COUNT = 8
export const DUNGEON_STEP_X = 6
export const DUNGEON_STEP_DX = 7
export const DUNGEON_STEP_Y = 4
export const DUNGEON_STEP_DY = 2
export const DUNGEON_LANDING = { x: 55, y: 20 } as const
export const DUNGEON_TORCHES = [10, 62] as const
export const DUNGEON_TORCH_Y = 8
export const DUNGEON_DRIPS = [22, 38, 54] as const
export const DUNGEON_DRIP_TOP = 2
export const DUNGEON_DRIP_ROWS = 14
export const DUNGEON_FLOOR_TOP = 21
export const DUNGEON_CHEST = { x: 34, y: 16 } as const
export const DUNGEON_COIN_PILES = [28, 45] as const
/** Coin glints in row-major order, shared by both renderers. */
export const DUNGEON_GLINTS = [
  { x: 29, y: 18 },
  { x: 46, y: 18 },
  { x: 37, y: 15 },
] as const
export const DUNGEON_PILLARS = [8, 66] as const
export const DUNGEON_PILLAR_TOP = 12
export const DUNGEON_PILLAR_BASE = 20
export const DUNGEON_CYCLE_MS = 2400

/** Palette shared by the text and pixel renderers. */
export const DUNGEON_COLORS = {
  "dungeon-descent": {
    wall: "#141018",
    skyBottom: "#0a080e",
    stone: "#5a5a6e",
    stoneDark: "#3a3a4a",
    step: "#6e6e7e",
    wood: "#6e4a2a",
    flame: "#ffb14e",
    drip: "#6ab5d3",
    floor: "#2e2a34",
    chest: "#4a3a2a",
    gold: "#c8a84a",
    coin: "#ffd166",
    glint: "#fff2c8",
  },
  "dungeon-treasure": {
    wall: "#1c1410",
    skyBottom: "#100a06",
    stone: "#6e6258",
    stoneDark: "#4a423a",
    step: "#7e7268",
    wood: "#7e5a34",
    flame: "#ffc14e",
    drip: "#7ac5e3",
    floor: "#3a2e24",
    chest: "#8a5a2a",
    gold: "#e8c84a",
    coin: "#ffe166",
    glint: "#fff8d8",
  },
} as const satisfies Record<DungeonStyle, Record<string, string>>

export function dungeonBackground(style: DungeonStyle) {
  return style === "dungeon-descent" ? "#0d0a10" : "#140d08"
}

/** Loop phase in [0, 1). All motion derives from it so frames loop bit-identically. */
export function dungeonPhase(elapsedMs: number): number {
  return (Math.max(0, elapsedMs) % DUNGEON_CYCLE_MS) / DUNGEON_CYCLE_MS
}

/** Torch flames flicker on a 200ms beat, bright at rest. */
export function dungeonFlicker(elapsedMs: number): boolean {
  return Math.floor(Math.max(0, elapsedMs) / 200) % 2 === 0
}

/** Coin glints take turns shining on a 400ms beat. */
export function dungeonTwinkle(elapsedMs: number, index: number): boolean {
  return (Math.floor(Math.max(0, elapsedMs) / 400) + index) % 3 === 0
}

/** Scene-space Y of a falling drip, looping through the shaft rows. */
export function dungeonDripY(elapsedMs: number, index: number): number {
  const fall = Math.floor(dungeonPhase(elapsedMs) * DUNGEON_DRIP_ROWS)
  return DUNGEON_DRIP_TOP + ((index * 5 + fall) % DUNGEON_DRIP_ROWS)
}

export function dungeonRows(columns: number, rows: number, style: DungeonStyle, elapsedMs: number): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const descent = style === "dungeon-descent"
  const colors = DUNGEON_COLORS[style]
  const flame = dungeonFlicker(elapsedMs)
  const grid: FujiRun[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: colors.wall })),
  )
  const left = Math.floor((width - DUNGEON_COLUMNS) / 2),
    top = Math.floor((height - DUNGEON_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + Math.round(y)
    if (row < 0 || row >= height) return
    for (let i = 0; i < text.length; i++) {
      const sceneX = Math.round(x) + i
      const column = left + sceneX
      if (sceneX < 0 || sceneX >= DUNGEON_COLUMNS || column < 0 || column >= width) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }
  // Ceiling and side walls of the chamber.
  paint(0, 0, "#".repeat(DUNGEON_COLUMNS), colors.stoneDark)
  for (let y = 1; y < DUNGEON_FLOOR_TOP; y++) {
    paint(0, y, "##", colors.stoneDark)
    paint(DUNGEON_COLUMNS - 2, y, "##", colors.stoneDark)
  }
  // Falling drips pass behind the stairs and the chest.
  DUNGEON_DRIPS.forEach((dx, i) => {
    paint(dx, dungeonDripY(elapsedMs, i), "o", colors.drip)
  })
  if (descent) {
    for (let s = 0; s < DUNGEON_STEP_COUNT; s++) {
      const sx = DUNGEON_STEP_X + s * DUNGEON_STEP_DX
      const sy = DUNGEON_STEP_Y + s * DUNGEON_STEP_DY
      paint(sx, sy, "_______", colors.step)
      paint(sx + DUNGEON_STEP_DX, sy + 1, "|", colors.stoneDark)
    }
    paint(DUNGEON_LANDING.x, DUNGEON_LANDING.y, "_______________", colors.step)
  } else {
    for (const pillar of DUNGEON_PILLARS) {
      paint(pillar - 1, DUNGEON_PILLAR_TOP - 1, "====", colors.stoneDark)
      for (let y = DUNGEON_PILLAR_TOP; y < DUNGEON_PILLAR_BASE; y++) {
        paint(pillar, y, "||", colors.stone)
      }
      paint(pillar - 1, DUNGEON_PILLAR_BASE, "====", colors.stoneDark)
    }
    const chest = DUNGEON_CHEST
    if (flame) {
      paint(chest.x - 2, chest.y, "~", colors.glint)
      paint(chest.x + 9, chest.y, "~", colors.glint)
    }
    paint(chest.x, chest.y, ".------.", colors.gold)
    paint(chest.x, chest.y + 1, "| $$$$ |", colors.coin, colors.chest)
    paint(chest.x, chest.y + 2, "'------'", colors.gold)
    for (const pile of DUNGEON_COIN_PILES) {
      paint(pile, chest.y + 3, "$$$", colors.coin)
    }
    DUNGEON_GLINTS.forEach((glint, i) => {
      paint(glint.x, glint.y, dungeonTwinkle(elapsedMs, i) ? "*" : ".", colors.glint)
    })
  }
  // Torches bracket the chamber in both scenes.
  for (const torch of DUNGEON_TORCHES) {
    paint(torch, DUNGEON_TORCH_Y, flame ? "*" : "+", flame ? colors.flame : colors.wood)
    paint(torch, DUNGEON_TORCH_Y + 1, "|", colors.wood)
    paint(torch, DUNGEON_TORCH_Y + 2, "|", colors.wood)
  }
  for (let y = DUNGEON_FLOOR_TOP; y < DUNGEON_ROWS; y++) {
    paint(0, y, " ".repeat(DUNGEON_COLUMNS), colors.floor, colors.floor)
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
