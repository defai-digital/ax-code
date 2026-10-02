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

/**
 * Scene-space rows and tile-run origins. Tiles sit on a three-cell pitch so a
 * 28px-wide pixel tile and a two-character text tile share the same slots.
 * Opponent hands read as concealed backs; side hands run top to bottom.
 */
export const MAHJONG_MATCH_LAYOUT = {
  titleRow: 1,
  northLabelRow: 3,
  northHandRow: 4,
  northHandX: 19,
  northDiscardsRow: 7,
  discardsX: 31,
  sideLabelRow: 6,
  westX: 5,
  eastX: 66,
  sideHandRow: 8,
  westPondX: 10,
  eastPondX: 55,
  sideDiscardsRow: 12,
  viewRow: 10,
  diceRow: 13,
  southDiscardsRow: 15,
  southLabelRow: 17,
  southHandRow: 18,
  southHandX: 19,
  actionRow: 21,
  statusRow: 22,
  turnX: 53,
} as const

/** Center plate bounds (cells) shared by the pixel scene and the wall ring. */
export const MAHJONG_PLATE = { left: 26, top: 9.9, right: 50, bottom: 14.1 } as const

/** Scene-space rows for the ending: win reveal, then the ledger. */
export const MAHJONG_ENDING_LAYOUT = {
  titleRow: 3,
  handRow: 5,
  handX: 16,
  ledgerTitleRow: 10,
  firstScoreRow: 12,
  scoreRowGap: 2,
  thanksRow: 20,
  blinkRow: 22,
} as const

const MAHJONG_SEATS = ["SOUTH", "EAST", "NORTH", "WEST"] as const
export const MAHJONG_SCORES = [32000, 23000, 21000, 24000] as const
/** Dealer seat (index into the seat order) and the opening roll. */
export const MAHJONG_DEALER = 0
export const MAHJONG_DICE = [3, 5] as const

/** The thirty-four tile faces: nine circles, nine bamboo, nine characters, four winds, three dragons. */
const TILE_CODES: readonly string[] = [
  ...Array.from({ length: 9 }, (_, i) => `${i + 1}C`),
  ...Array.from({ length: 9 }, (_, i) => `${i + 1}B`),
  ...Array.from({ length: 9 }, (_, i) => `${i + 1}M`),
  "EW",
  "SW",
  "WW",
  "NW",
  "RD",
  "GD",
  "WD",
]
export const MAHJONG_TILE_COUNT = TILE_CODES.length

/** The winning hand shown in the ending: three runs, a wind triplet, and a dragon pair. */
export const MAHJONG_WIN_HAND: readonly number[] = [0, 1, 2, 12, 13, 14, 24, 25, 26, 27, 27, 27, 31, 31]
const MAHJONG_WIN_CYCLE_MS = 4800
const MAHJONG_WIN_STAGGER_MS = 130
const MAHJONG_WIN_FLIP_MS = 380
/** The celebration burst begins once the last tile has flipped. */
export const MAHJONG_WIN_BURST_MS = 2100

export function mahjongStep(elapsedMs: number): number {
  return Math.floor(Math.max(0, elapsedMs) / MAHJONG_STEP_MS) % MAHJONG_STEPS
}

/** Progress through the current 400ms step, in [0, 1). */
export function mahjongStepProgress(elapsedMs: number): number {
  return (Math.max(0, elapsedMs) % MAHJONG_STEP_MS) / MAHJONG_STEP_MS
}

/** Flip progress of winning-hand tile `index` in [0, 1]; 0.5 is edge-on. */
export function mahjongWinFlip(elapsedMs: number, index: number): number {
  const t = Math.max(0, elapsedMs) % MAHJONG_WIN_CYCLE_MS
  return Math.max(0, Math.min(1, (t - index * MAHJONG_WIN_STAGGER_MS) / MAHJONG_WIN_FLIP_MS))
}

/** Number of winning-hand tiles that already show their faces. */
export function mahjongWinFaceUp(elapsedMs: number): number {
  return MAHJONG_WIN_HAND.filter((_, i) => mahjongWinFlip(elapsedMs, i) >= 0.5).length
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

/** Dealer wind chip, drawn beside the dealer's seat label. */
export function mahjongDealerMarker(): { x: number; y: number; text: string } {
  const label = mahjongSeatLabel("SOUTH")
  return { x: label.x + label.text.length + 1, y: label.y, text: "[E]" }
}

/** Origin of discard slot `index` for a seat (0 south, 1 east, 2 north, 3 west). */
export function mahjongPondSlot(seat: number, index: number): { x: number; y: number } {
  const layout = MAHJONG_MATCH_LAYOUT
  if (seat === 2) return { x: layout.discardsX + index * 3, y: layout.northDiscardsRow }
  if (seat === 0) return { x: layout.discardsX + index * 3, y: layout.southDiscardsRow }
  if (seat === 3) return { x: layout.westPondX + index * 3, y: layout.sideDiscardsRow }
  return { x: layout.eastPondX + index * 3, y: layout.sideDiscardsRow }
}

/** Marker cell under the latest discard, or null before the first turn. */
export function mahjongLatestMarker(elapsedMs: number): { x: number; y: number } | null {
  const step = mahjongStep(elapsedMs)
  if (step === 0) return null
  const seat = (step - 1) % MAHJONG_SEATS.length
  const index = mahjongMatch(elapsedMs).discards[seat]!.length - 1
  const slot = mahjongPondSlot(seat, index)
  return { x: slot.x, y: slot.y + 1 }
}

/** Filled cells of the wall progress bar for a remaining wall count. */
export function mahjongWallFill(wall: number): number {
  return Math.round((Math.max(0, wall) / 84) * MAHJONG_WALL_BAR_LEN)
}

export type MahjongTileFace = {
  family: "circles" | "bamboo" | "characters" | "wind" | "dragon"
  /** Rank 1-9 for suits; zero-based wind (E S W N) or dragon (red green white) index for honors. */
  count: number
}
export function mahjongTileFace(tile: number): MahjongTileFace {
  const t = ((Math.floor(tile) % TILE_CODES.length) + TILE_CODES.length) % TILE_CODES.length
  if (t < 9) return { family: "circles", count: t + 1 }
  if (t < 18) return { family: "bamboo", count: t - 8 }
  if (t < 27) return { family: "characters", count: t - 17 }
  if (t < 31) return { family: "wind", count: t - 27 }
  return { family: "dragon", count: t - 31 }
}

export function mahjongTileCode(tile: number): string {
  return TILE_CODES[((Math.floor(tile) % TILE_CODES.length) + TILE_CODES.length) % TILE_CODES.length]!
}

export function mahjongSuitColor(tile: number): string {
  const family = mahjongTileFace(tile).family
  const suits = MAHJONG_COLORS.suits
  if (family === "circles") return suits[0]
  if (family === "bamboo") return suits[1]
  if (family === "characters") return suits[2]
  return suits[3]
}

// A decorative, deterministic match timeline, not a playable game. Deriving
// frames from time avoids timers, resize resets, or accumulating game state.
// Exposed hands are sorted the way a player keeps them; `draw` is the tile the
// seat on turn is holding.
export function mahjongMatch(elapsedMs: number) {
  const step = mahjongStep(elapsedMs)
  const hands = MAHJONG_SEATS.map((_, seat) =>
    Array.from({ length: 13 }, (_, i) => (i * 3 + seat * 2) % TILE_CODES.length),
  )
  const discards: number[][] = MAHJONG_SEATS.map(() => [])
  let action = "MATCH COMMENCING"
  for (let turn = 0; turn < step; turn++) {
    const seat = turn % 4,
      index = (turn * 5) % 13
    const tile = hands[seat]![index]!
    discards[seat]!.push(tile)
    hands[seat]![index] = (tile + 4) % TILE_CODES.length
    action = `${MAHJONG_SEATS[seat]} DISCARDS ${TILE_CODES[tile]}`
  }
  const turnSeat = step % 4
  const draw = (hands[turnSeat]![(step * 5) % 13]! + 11) % TILE_CODES.length
  return {
    hands: hands.map((hand) => [...hand].sort((a, b) => a - b)),
    discards,
    wall: 84 - step,
    turn: MAHJONG_SEATS[turnSeat]!,
    action,
    draw,
  }
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
  const tiles = (x: number, y: number, hand: readonly number[], hidden = false, vertical = false) =>
    hand.forEach((tile, i) => {
      const at = vertical ? { x, y: y + i } : { x: x + i * 3, y }
      paint(at.x, at.y, hidden ? "##" : mahjongTileCode(tile), hidden ? colors.good : mahjongSuitColor(tile))
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
    MAHJONG_WIN_HAND.forEach((tile, i) => {
      const x = ending.handX + i * 3 + (i === MAHJONG_WIN_HAND.length - 1 ? 1 : 0)
      const up = mahjongWinFlip(elapsedMs, i) >= 0.5
      const last = i === MAHJONG_WIN_HAND.length - 1
      paint(
        x,
        ending.handRow,
        up ? mahjongTileCode(tile) : "##",
        up ? (last ? colors.accent : mahjongSuitColor(tile)) : colors.good,
      )
    })
    center(ending.ledgerTitleRow, "FINAL POINT LEDGER", colors.info)
    center(ending.ledgerTitleRow - 1, "- - - - - -", colors.frame)
    for (let i = 0; i < MAHJONG_SEATS.length; i++) {
      const rank = mahjongRank(i)
      center(ending.firstScoreRow + i * ending.scoreRowGap, mahjongRankedLine(i), mahjongRankColor(rank))
    }
    center(ending.thanksRow - 1, "- - - - - -", colors.frame)
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
    tiles(layout.westX, layout.sideHandRow, match.hands[3]!, true, true)
    tiles(layout.eastX, layout.sideHandRow, match.hands[1]!, true, true)
    tiles(layout.westPondX, layout.sideDiscardsRow, match.discards[3]!)
    tiles(layout.eastPondX, layout.sideDiscardsRow, match.discards[1]!)
    center(layout.viewRow, "-- MATCH VIEW --", colors.info)
    center(layout.diceRow, `DICE ${MAHJONG_DICE[0]} ${MAHJONG_DICE[1]}`, colors.accent)
    tiles(layout.discardsX, layout.southDiscardsRow, match.discards[0]!)
    seat("SOUTH")
    const dealer = mahjongDealerMarker()
    paint(dealer.x, dealer.y, dealer.text, colors.accent)
    tiles(layout.southHandX, layout.southHandRow, match.hands[0]!)
    // The seat on turn holds a drawn tile one gap past its hand.
    const holder = MAHJONG_SEATS.indexOf(match.turn as (typeof MAHJONG_SEATS)[number])
    if (holder === 0) tiles(layout.southHandX + 40, layout.southHandRow, [match.draw])
    else if (holder === 2) tiles(layout.northHandX + 40, layout.northHandRow, [match.draw], true)
    else if (holder === 3) tiles(layout.westX, layout.sideHandRow + 13, [match.draw], true, true)
    else tiles(layout.eastX, layout.sideHandRow + 13, [match.draw], true, true)
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
