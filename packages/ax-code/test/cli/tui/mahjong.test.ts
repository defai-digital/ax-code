import { expect, test } from "vitest"
import { inflateSync } from "node:zlib"
import {
  mahjongRows,
  mahjongMatch,
  mahjongStep,
  mahjongEndingBlink,
  mahjongLatestMarker,
  mahjongRank,
  mahjongRankColor,
  mahjongRankedLine,
  mahjongSeatLabel,
  mahjongWallFill,
  mahjongTileFace,
  mahjongTileCode,
  mahjongSuitColor,
  mahjongWinFlip,
  mahjongWinFaceUp,
  mahjongDealerMarker,
  mahjongPondSlot,
  MAHJONG_WIN_HAND,
  MAHJONG_TILE_COUNT,
} from "../../../src/cli/tui/component/mahjong-view-model"
import { renderTextScenePixels } from "../../../src/cli/tui/component/text-scene-pixels"
import { digitalCodePixelPlayer } from "../../../src/cli/tui/component/digital-code-pixels"

const text = (rows: ReturnType<typeof mahjongRows>) => rows.map((row) => row.map((run) => run.text).join("")).join("\n")
test("match advances seats and discards with bounded repeatable state", () => {
  expect(mahjongMatch(0)).toEqual(mahjongMatch(4800))
  expect(mahjongMatch(-10)).toEqual(mahjongMatch(0))
  for (let step = 0; step < 12; step++) {
    const match = mahjongMatch(step * 400)
    expect(match.wall).toBe(84 - step)
    expect(match.discards.flat()).toHaveLength(step)
    expect(match.turn).toBe(["SOUTH", "EAST", "NORTH", "WEST"][step % 4])
    expect(match.hands.every((hand) => hand.length === 13)).toBe(true)
    // Exposed hands are kept sorted and every tile is a real face.
    for (const hand of match.hands) {
      expect([...hand].sort((a, b) => a - b)).toEqual(hand)
      expect(hand.every((tile) => tile >= 0 && tile < MAHJONG_TILE_COUNT)).toBe(true)
    }
    expect(match.draw).toBeGreaterThanOrEqual(0)
    expect(match.draw).toBeLessThan(MAHJONG_TILE_COUNT)
  }
  expect(mahjongStep(-10)).toBe(0)
  expect(mahjongStep(4800)).toBe(0)
  expect(mahjongEndingBlink(0)).toBe(false)
  expect(mahjongEndingBlink(400)).toBe(true)
  expect(mahjongEndingBlink(800)).toBe(false)
})
test.each(["mahjong-match", "mahjong-ending"] as const)("%s has a safe text fallback", (style) => {
  for (const [w, h] of [
    [0, 0],
    [1, 1],
    [36, 20],
    [80, 30],
    [120, 40],
  ]) {
    const rows = mahjongRows(w!, h!, style, 1200)
    expect(rows).toHaveLength(h!)
    for (const row of rows) expect(row.map((run) => run.text).join("")).toMatch(new RegExp(`^[\\x20-\\x7e]{${w}}$`))
  }
})
test("open tiles wear suit colors and the active seat takes the spotlight", () => {
  const rows = mahjongRows(76, 25, "mahjong-match", 1200)
  expect(rows.flat().some((run) => run.color === "#2563eb")).toBe(true)
  expect(mahjongSeatLabel("WEST")).toEqual({ x: 5, y: 6, text: "WEST" })
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(6).slice(5, 9)).toBe("WEST")
  expect(rows[6]!.some((run) => run.background === "#065f46")).toBe(true)
  expect(line(10)).toContain("-- MATCH VIEW --")
  expect(line(13)).toContain("DICE 3 5")
  expect(line(17)).toContain("YOU (SOUTH) [E]")
})

test("the tile set covers circles, bamboo, characters, winds, and dragons", () => {
  expect(MAHJONG_TILE_COUNT).toBe(34)
  expect(mahjongTileFace(0)).toEqual({ family: "circles", count: 1 })
  expect(mahjongTileFace(8)).toEqual({ family: "circles", count: 9 })
  expect(mahjongTileFace(9)).toEqual({ family: "bamboo", count: 1 })
  expect(mahjongTileFace(26)).toEqual({ family: "characters", count: 9 })
  expect(mahjongTileFace(27)).toEqual({ family: "wind", count: 0 })
  expect(mahjongTileFace(33)).toEqual({ family: "dragon", count: 2 })
  expect(mahjongTileFace(34)).toEqual(mahjongTileFace(0))
  expect(mahjongTileCode(0)).toBe("1C")
  expect(mahjongTileCode(12)).toBe("4B")
  expect(mahjongTileCode(25)).toBe("8M")
  expect(mahjongTileCode(31)).toBe("RD")
  expect(new Set([0, 9, 18, 27].map((tile) => mahjongSuitColor(tile))).size).toBe(4)
  expect(mahjongDealerMarker()).toEqual({ x: 44, y: 17, text: "[E]" })
  expect(mahjongPondSlot(0, 2)).toEqual({ x: 37, y: 15 })
})

test("the winning hand is complete and flips face up tile by tile", () => {
  // Three runs, a wind triplet, and a dragon pair: fourteen tiles.
  expect(MAHJONG_WIN_HAND.map(mahjongTileCode).join(" ")).toBe("1C 2C 3C 4B 5B 6B 7M 8M 9M EW EW EW RD RD")
  expect(mahjongWinFlip(0, 0)).toBe(0)
  expect(mahjongWinFlip(190, 0)).toBeCloseTo(0.5)
  expect(mahjongWinFlip(100000, 0)).toBe(1)
  expect(mahjongWinFlip(4800, 5)).toBe(0)
  const counts = [0, 400, 800, 1200, 1600, 2400].map(mahjongWinFaceUp)
  expect(counts).toEqual([...counts].sort((a, b) => a - b))
  expect(counts[0]).toBe(0)
  expect(counts.at(-1)).toBe(14)
})

test("latest discard marker and wall bar track the match timeline", () => {
  expect(mahjongLatestMarker(0)).toBeNull()
  expect(mahjongLatestMarker(1200)).toEqual({ x: 31, y: 8 })
  expect(mahjongWallFill(84)).toBe(20)
  expect(mahjongWallFill(0)).toBe(0)
  const rows = mahjongRows(76, 25, "mahjong-match", 1200)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(8).slice(31, 33)).toBe("**")
  expect(line(22)).toContain("WALL: 81")
  expect(line(22)).toContain("[" + "#".repeat(19) + "-]")
})

test("ending ranks seats with medals between decorative rules", () => {
  expect([mahjongRank(0), mahjongRank(1), mahjongRank(2), mahjongRank(3)]).toEqual([1, 3, 4, 2])
  expect(mahjongRankColor(1)).toBe("#fbbf24")
  expect(mahjongRankedLine(0)).toBe("[1] SOUTH    32000 PTS")
  const rows = mahjongRows(76, 25, "mahjong-ending", 400)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(12)).toContain("[1] SOUTH    32000 PTS")
  expect(line(9)).toContain("- - - - - -")
  expect(line(19)).toContain("- - - - - -")
})

test("ending text reveals the winning hand as tiles flip", () => {
  const line = (ms: number) =>
    mahjongRows(76, 25, "mahjong-ending", ms)[5]!
      .map((run) => run.text)
      .join("")
  expect(line(0)).toContain("## ## ##")
  expect(line(0)).not.toContain("1C")
  expect(line(3000)).toContain("1C 2C 3C 4B 5B 6B 7M 8M 9M EW EW EW")
  expect(line(3000).slice(56, 58)).toBe("RD")
  // The winning tile is highlighted in gold once it turns.
  const rows = mahjongRows(76, 25, "mahjong-ending", 3000)
  expect(rows[5]!.some((run) => run.color === "#fbbf24" && run.text.includes("RD"))).toBe(true)
})

test.each(["mahjong-match", "mahjong-ending"] as const)("%s frames an inner border", (style) => {
  const rows = mahjongRows(76, 25, style, 1200)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(2)[3]).toBe("+")
  expect(line(23)[72]).toBe("+")
  expect(rows.flat().some((run) => run.color === "#047857")).toBe(true)
})

test("ending is a score ledger without returning to match playback", () => {
  for (const ms of [0, 3000, 100000]) {
    const output = text(mahjongRows(76, 25, "mahjong-ending", ms))
    expect(output).toContain("HAND COMPLETED")
    expect(output).toContain("32000 PTS")
    expect(output).not.toContain("WALL:")
  }
  expect(text(mahjongRows(76, 25, "mahjong-match", 0))).toContain("##")
})
test("Mahjong uses bounded lossless graphics and deletes images on resize and exit", () => {
  const writes: string[] = [],
    player = digitalCodePixelPlayer((data) => writes.push(data))
  const input = {
    width: 800,
    height: 540,
    columns: 80,
    rows: 30,
    direction: "down" as const,
    style: "mahjong-match" as const,
    elapsedMs: 1200,
  }
  player.draw(input)
  const payload = [...writes[0]!.matchAll(/\x1b_G[^;]+;([A-Za-z0-9+/=]*)\x1b\\/g)].map((m) => m[1]).join("")
  expect(inflateSync(Buffer.from(payload, "base64"))).toEqual(renderTextScenePixels(800, 540, "mahjong-match", 1200))
  player.draw({ ...input, width: 600, style: "mahjong-ending" })
  expect(writes[1]).toContain("a=d,d=I")
  player.dispose()
  expect(writes[3]).toContain("a=d,d=I")
  player.draw(input)
  expect(writes).toHaveLength(4)
})
