import type { FujiRun } from "./fuji-view-model"

export type MahjongStyle = "mahjong-match" | "mahjong-ending"
export const MAHJONG_COLUMNS = 76
export const MAHJONG_ROWS = 25
export function isMahjongStyle(style: string | undefined): style is MahjongStyle {
  return style === "mahjong-match" || style === "mahjong-ending"
}

/** Match timeline: twelve 400ms steps per cycle. */
const MAHJONG_STEP_MS = 400
const MAHJONG_STEPS = 12

/** Palette shared by the text and pixel renderers. */
export const MAHJONG_COLORS = {
  felt: "#042f22",
  feltDeep: "#021a12",
  frame: "#059669",
  frameDim: "#047857",
  ink: "#ecfdf5",
  accent: "#fbbf24",
  info: "#67e8f9",
  good: "#34d399",
  tileFace: "#ecfdf5",
  tileEdge: "#064e3b",
  tileBack: "#065f46",
  tileBackInk: "#34d399",
  suits: ["#2563eb", "#059669", "#dc2626", "#b45309"],
} as const
export const MAHJONG_BACKGROUND = MAHJONG_COLORS.felt

/** Sample the vertical felt gradient. `t` is 0 at the top of the frame. */
export function mahjongFeltRgb(t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(MAHJONG_COLORS.felt.slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(MAHJONG_COLORS.feltDeep.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

/** Scene-space table frame in the shared 76x25 space. */
export const MAHJONG_TABLE = { left: 1, top: 0, right: 74, bottom: 24 } as const

/** Inner border inset from the table frame. */
export const MAHJONG_INNER = { left: 3, top: 2, right: 72, bottom: 23 } as const

/** Wall progress bar geometry on the status row. */
export const MAHJONG_WALL_BAR_X = 14
export const MAHJONG_WALL_BAR_LEN = 20

/** Scene-space rows and tile-run origins for the match labels. */
export const MAHJONG_MATCH_LAYOUT = {
  titleRow: 1,
  northLabelRow: 3,
  northHandRow: 4,
  northHandX: 19,
  northDiscardsRow: 6,
  discardsX: 31,
  sideLabelRow: 8,
  westX: 5,
  eastX: 58,
  sideHandRow: 10,
  sideDiscardsRow: 12,
  viewRow: 11,
  southDiscardsRow: 14,
  southLabelRow: 16,
  southHandRow: 18,
  southHandX: 19,
  actionRow: 20,
  statusRow: 22,
  turnX: 53,
} as const

/** Scene-space rows for the ending ledger. */
export const MAHJONG_ENDING_LAYOUT = {
  titleRow: 3,
  ledgerTitleRow: 6,
  firstScoreRow: 9,
  scoreRowGap: 2,
  thanksRow: 19,
  blinkRow: 21,
} as const

const MAHJONG_SEATS = ["SOUTH", "EAST", "NORTH", "WEST"] as const
export const MAHJONG_SCORES = [32000, 23000, 21000, 24000] as const
const SUITS = ["1C", "2C", "3C", "4C", "5C", "6C", "1B", "2B", "3B", "4B", "RD", "GD", "WD"]

export function mahjongStep(elapsedMs: number): number {
  return Math.floor(Math.max(0, elapsedMs) / MAHJONG_STEP_MS) % MAHJONG_STEPS
}

/** Ending twinkle phase. Both renderers flip the marker together. */
export function mahjongEndingBlink(elapsedMs: number): boolean {
  return Math.floor(Math.max(0, elapsedMs) / MAHJONG_STEP_MS) % 2 === 1
}

export function mahjongCenterX(text: string): number {
  return Math.floor((MAHJONG_COLUMNS - text.length) / 2)
}

export function mahjongScoreLine(seat: number): string {
  return `${MAHJONG_SEATS[seat]!.padEnd(8)} ${String(MAHJONG_SCORES[seat]).padStart(5)} PTS`
}

/** 1-based rank of a seat by final score. */
export function mahjongRank(seat: number): number {
  const mine = MAHJONG_SCORES[seat]!
  return 1 + MAHJONG_SCORES.filter((score) => score > mine).length
}

/** Medal color for a 1-based rank. */
export function mahjongRankColor(rank: number): string {
  const medals = [MAHJONG_COLORS.accent, MAHJONG_COLORS.info, MAHJONG_COLORS.good, MAHJONG_COLORS.ink]
  return medals[Math.min(medals.length, Math.max(1, rank)) - 1]!
}

export function mahjongRankedLine(seat: number): string {
  return `[${mahjongRank(seat)}] ${mahjongScoreLine(seat)}`
}

/** Seat label geometry in the shared match layout. */
export function mahjongSeatLabel(seat: string): { x: number; y: number; text: string } {
  const layout = MAHJONG_MATCH_LAYOUT
  if (seat === "NORTH") return { x: mahjongCenterX("NORTH"), y: layout.northLabelRow, text: "NORTH" }
  if (seat === "WEST") return { x: layout.westX, y: layout.sideLabelRow, text: "WEST" }
  if (seat === "EAST") return { x: layout.eastX, y: layout.sideLabelRow, text: "EAST" }
  return { x: mahjongCenterX("YOU (SOUTH)"), y: layout.southLabelRow, text: "YOU (SOUTH)" }
}

/** Marker cell under the latest discard, or null before the first turn. */
export function mahjongLatestMarker(elapsedMs: number): { x: number; y: number } | null {
  const step = mahjongStep(elapsedMs)
  if (step === 0) return null
  const seat = (step - 1) % MAHJONG_SEATS.length
  const index = mahjongMatch(elapsedMs).discards[seat]!.length - 1
  const layout = MAHJONG_MATCH_LAYOUT
  if (seat === 2) return { x: layout.discardsX + index * 3, y: layout.northDiscardsRow + 1 }
  if (seat === 0) return { x: layout.discardsX + index * 3, y: layout.southDiscardsRow + 1 }
  if (seat === 3) return { x: layout.westX + index * 3, y: layout.sideDiscardsRow + 1 }
  return { x: layout.eastX + index * 3, y: layout.sideDiscardsRow + 1 }
}

/** Filled cells of the wall progress bar for a remaining wall count. */
export function mahjongWallFill(wall: number): number {
  return Math.round((Math.max(0, wall) / 84) * MAHJONG_WALL_BAR_LEN)
}

type MahjongTileFace = { family: "circles" | "bamboo" | "honor"; count: number }
/** Tile index 0-5 are circles, 6-9 bamboo bars, 10-12 honor plates. */
export function mahjongTileFace(tile: number): MahjongTileFace {
  if (tile <= 5) return { family: "circles", count: tile + 1 }
  if (tile <= 9) return { family: "bamboo", count: tile - 5 }
  return { family: "honor", count: 0 }
}

export function mahjongSuitColor(tile: number): string {
  return MAHJONG_COLORS.suits[tile % MAHJONG_COLORS.suits.length]!
}

// A decorative, deterministic match timeline, not a playable game. Deriving
// frames from time avoids timers, resize resets, or accumulating game state.
export function mahjongMatch(elapsedMs: number) {
  const step = mahjongStep(elapsedMs)
  const hands = MAHJONG_SEATS.map((_, seat) => Array.from({ length: 13 }, (_, i) => (i * 3 + seat * 2) % SUITS.length))
  const discards: number[][] = MAHJONG_SEATS.map(() => [])
  let action = "MATCH COMMENCING"
  for (let turn = 0; turn < step; turn++) {
    const seat = turn % 4,
      index = (turn * 5) % 13
    const tile = hands[seat]![index]!
    discards[seat]!.push(tile)
    hands[seat]![index] = (tile + 4) % SUITS.length
    action = `${MAHJONG_SEATS[seat]} DISCARDS ${SUITS[tile]}`
  }
  return { hands, discards, wall: 84 - step, turn: MAHJONG_SEATS[step % 4]!, action }
}

export function mahjongRows(columns: number, rows: number, style: MahjongStyle, elapsedMs: number): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const colors = MAHJONG_COLORS
  const grid: FujiRun[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: colors.ink })),
  )
  const left = Math.floor((width - MAHJONG_COLUMNS) / 2),
    top = Math.floor((height - MAHJONG_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color: string = colors.ink, background?: string) => {
    for (let i = 0; i < text.length; i++) {
      const xx = left + x + i,
        yy = top + y
      if (xx < 0 || xx >= width || yy < 0 || yy >= height || x + i >= MAHJONG_COLUMNS) continue
      grid[yy]![xx] = { text: text[i]!, color, background }
    }
  }
  const center = (y: number, text: string, color?: string) => paint(mahjongCenterX(text), y, text, color)
  const tiles = (x: number, y: number, hand: number[], hidden = false) =>
    hand.forEach((tile, i) => {
      paint(x + i * 3, y, hidden ? "##" : SUITS[tile]!, hidden ? colors.good : mahjongSuitColor(tile))
    })
  const table = MAHJONG_TABLE
  for (let y = 1; y < table.bottom; y++) {
    paint(table.left, y, "|", colors.frame)
    paint(table.right, y, "|", colors.frame)
  }
  paint(table.left, table.top, "+" + "-".repeat(table.right - table.left - 1) + "+", colors.frame)
  paint(table.left, table.bottom, "+" + "-".repeat(table.right - table.left - 1) + "+", colors.frame)
  const inner = MAHJONG_INNER
  for (let y = inner.top + 1; y < inner.bottom; y++) {
    paint(inner.left, y, "|", colors.frameDim)
    paint(inner.right, y, "|", colors.frameDim)
  }
  paint(inner.left, inner.top, "+" + "-".repeat(inner.right - inner.left - 1) + "+", colors.frameDim)
  paint(inner.left, inner.bottom, "+" + "-".repeat(inner.right - inner.left - 1) + "+", colors.frameDim)
  if (style === "mahjong-ending") {
    const ending = MAHJONG_ENDING_LAYOUT
    center(ending.titleRow, "HAND COMPLETED", colors.accent)
    center(ending.ledgerTitleRow, "FINAL POINT LEDGER", colors.info)
    center(ending.ledgerTitleRow - 1, "- - - - - -", colors.frame)
    for (let i = 0; i < MAHJONG_SEATS.length; i++) {
      const rank = mahjongRank(i)
      center(ending.firstScoreRow + i * ending.scoreRowGap, mahjongRankedLine(i), mahjongRankColor(rank))
    }
    center(ending.thanksRow - 2, "- - - - - -", colors.frame)
    center(ending.thanksRow, "THANK YOU FOR PLAYING", colors.good)
    center(ending.blinkRow, mahjongEndingBlink(elapsedMs) ? "*   *   *" : "  *   *  ", colors.accent)
  } else {
    const layout = MAHJONG_MATCH_LAYOUT
    const match = mahjongMatch(elapsedMs)
    const seat = (name: string) => {
      const label = mahjongSeatLabel(name)
      if (match.turn === name) paint(label.x, label.y, label.text, colors.accent, colors.tileBack)
      else paint(label.x, label.y, label.text)
    }
    center(layout.titleRow, "MAHJONG MATCH", colors.accent)
    seat("NORTH")
    tiles(layout.northHandX, layout.northHandRow, match.hands[2]!, true)
    tiles(layout.discardsX, layout.northDiscardsRow, match.discards[2]!)
    seat("WEST")
    seat("EAST")
    tiles(layout.westX, layout.sideHandRow, match.hands[3]!.slice(0, 4), true)
    tiles(layout.eastX, layout.sideHandRow, match.hands[1]!.slice(0, 4), true)
    tiles(layout.westX, layout.sideDiscardsRow, match.discards[3]!)
    tiles(layout.eastX, layout.sideDiscardsRow, match.discards[1]!)
    center(layout.viewRow, "-- MATCH VIEW --", colors.info)
    tiles(layout.discardsX, layout.southDiscardsRow, match.discards[0]!)
    seat("SOUTH")
    tiles(layout.southHandX, layout.southHandRow, match.hands[0]!)
    const marker = mahjongLatestMarker(elapsedMs)
    if (marker) paint(marker.x, marker.y, "**", colors.accent)
    center(layout.actionRow, match.action, colors.info)
    paint(layout.westX, layout.statusRow, `WALL: ${match.wall}`, colors.good)
    const fill = mahjongWallFill(match.wall)
    paint(MAHJONG_WALL_BAR_X, layout.statusRow, "[", colors.ink)
    paint(MAHJONG_WALL_BAR_X + 1, layout.statusRow, "#".repeat(fill), colors.good)
    paint(MAHJONG_WALL_BAR_X + 1 + fill, layout.statusRow, "-".repeat(MAHJONG_WALL_BAR_LEN - fill), colors.frameDim)
    paint(MAHJONG_WALL_BAR_X + 1 + MAHJONG_WALL_BAR_LEN, layout.statusRow, "]", colors.ink)
    paint(layout.turnX, layout.statusRow, `TURN: ${match.turn}`, colors.accent)
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
