import type { FujiRun } from "./fuji-view-model"

export type MahjongStyle = "mahjong-match" | "mahjong-ending"
export const MAHJONG_COLUMNS = 76
export const MAHJONG_ROWS = 25
export const MAHJONG_BACKGROUND = "#042f22"
export function isMahjongStyle(style: string | undefined): style is MahjongStyle {
  return style === "mahjong-match" || style === "mahjong-ending"
}
const SEATS = ["SOUTH", "EAST", "NORTH", "WEST"] as const
const SUITS = ["1C", "2C", "3C", "4C", "5C", "6C", "1B", "2B", "3B", "4B", "RD", "GD", "WD"]
const COLORS = ["#2563eb", "#059669", "#dc2626", "#b45309"]

// A decorative, deterministic match timeline, not a playable game. Deriving
// frames from time avoids timers, resize resets, or accumulating game state.
export function mahjongMatch(elapsedMs: number) {
  const step = Math.floor(Math.max(0, elapsedMs) / 400) % 12
  const hands = SEATS.map((_, seat) => Array.from({ length: 13 }, (_, i) => (i * 3 + seat * 2) % SUITS.length))
  const discards: number[][] = SEATS.map(() => [])
  let action = "MATCH COMMENCING"
  for (let turn = 0; turn < step; turn++) {
    const seat = turn % 4,
      index = (turn * 5) % 13
    const tile = hands[seat]![index]!
    discards[seat]!.push(tile)
    hands[seat]![index] = (tile + 4) % SUITS.length
    action = `${SEATS[seat]} DISCARDS ${SUITS[tile]}`
  }
  return { hands, discards, wall: 84 - step, turn: SEATS[step % 4]!, action }
}

export function mahjongRows(
  columns: number,
  rows: number,
  style: MahjongStyle,
  elapsedMs: number,
  pixels = false,
): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const grid: FujiRun[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: "#ecfdf5" })),
  )
  const left = Math.floor((width - MAHJONG_COLUMNS) / 2),
    top = Math.floor((height - MAHJONG_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color = "#ecfdf5", background?: string) => {
    for (let i = 0; i < text.length; i++) {
      const xx = left + x + i,
        yy = top + y
      if (xx < 0 || xx >= width || yy < 0 || yy >= height || x + i >= MAHJONG_COLUMNS) continue
      grid[yy]![xx] = { text: text[i]!, color, background }
    }
  }
  const center = (y: number, text: string, color?: string) =>
    paint(Math.floor((MAHJONG_COLUMNS - text.length) / 2), y, text, color)
  const tiles = (x: number, y: number, hand: number[], hidden = false) =>
    hand.forEach((tile, i) => {
      if (pixels)
        paint(
          x + i * 3,
          y,
          hidden ? "n" : String.fromCharCode(97 + tile),
          hidden ? "#34d399" : COLORS[tile % 4],
          hidden ? "#065f46" : "#ecfdf5",
        )
      else paint(x + i * 3, y, hidden ? "##" : SUITS[tile]!, hidden ? "#34d399" : "#ecfdf5")
    })
  for (let y = 1; y < 24; y++) {
    paint(1, y, "|", "#059669")
    paint(74, y, "|", "#059669")
  }
  paint(1, 0, "+" + "-".repeat(72) + "+", "#059669")
  paint(1, 24, "+" + "-".repeat(72) + "+", "#059669")
  if (style === "mahjong-ending") {
    center(3, "HAND COMPLETED", "#fbbf24")
    center(6, "FINAL POINT LEDGER", "#67e8f9")
    const scores = [32000, 23000, 21000, 24000]
    for (let i = 0; i < SEATS.length; i++)
      center(9 + i * 2, `${SEATS[i]!.padEnd(8)} ${String(scores[i]).padStart(5)} PTS`, i === 0 ? "#fbbf24" : "#ecfdf5")
    center(19, "THANK YOU FOR PLAYING", "#34d399")
    center(21, Math.floor(Math.max(0, elapsedMs) / 400) % 2 ? "*   *   *" : "  *   *  ", "#fbbf24")
  } else {
    const match = mahjongMatch(elapsedMs)
    center(1, "MAHJONG MATCH", "#fbbf24")
    center(3, "NORTH")
    tiles(19, 4, match.hands[2]!, true)
    tiles(31, 6, match.discards[2]!)
    paint(5, 8, "WEST")
    paint(58, 8, "EAST")
    tiles(5, 10, match.hands[3]!.slice(0, 4), true)
    tiles(58, 10, match.hands[1]!.slice(0, 4), true)
    tiles(5, 12, match.discards[3]!)
    tiles(58, 12, match.discards[1]!)
    center(11, "MATCH VIEW", "#67e8f9")
    tiles(31, 14, match.discards[0]!)
    center(16, "YOU (SOUTH)")
    tiles(19, 18, match.hands[0]!)
    center(20, match.action, "#67e8f9")
    paint(5, 22, `WALL: ${match.wall}`, "#34d399")
    paint(53, 22, `TURN: ${match.turn}`, "#fbbf24")
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
