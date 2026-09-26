import { expect, test } from "vitest"
import { inflateSync } from "node:zlib"
import {
  mahjongRows,
  mahjongMatch,
  mahjongStep,
  mahjongEndingBlink,
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
