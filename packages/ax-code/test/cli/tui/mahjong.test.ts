import { expect, test } from "vitest"
import { inflateSync } from "node:zlib"
import { mahjongRows, mahjongMatch } from "../../../src/cli/tui/component/mahjong-view-model"
import { renderTextScenePixels } from "../../../src/cli/tui/component/text-scene-pixels"
import { createDigitalCodePixels, digitalCodePixelPlayer } from "../../../src/cli/tui/component/digital-code-pixels"

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
})
test.each(["mahjong-match", "mahjong-ending"] as const)(
  "%s has safe text fallback and visible complete pixel glyphs",
  (style) => {
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
    const rows = mahjongRows(76, 25, style, 1200, true)
    const width = 800,
      height = 540
    const pixels = renderTextScenePixels(width, height, style, 1200)
    expect(pixels).toHaveLength(width * height * 3)
    expect([...pixels.subarray(0, 3)]).toEqual([4, 47, 34])
    // At this size every scene cell is 10x20, with 20px padding on each side.
    for (let y = 0; y < rows.length; y++) {
      let x = 0
      for (const run of rows[y]!)
        for (const char of run.text) {
          if (char !== " ") {
            const bg = run.background ? Buffer.from(run.background.slice(1), "hex") : Buffer.from([4, 47, 34])
            let ink = false
            for (let yy = 0; yy < 20; yy++)
              for (let xx = 0; xx < 10; xx++) {
                const offset = ((20 + y * 20 + yy) * width + 20 + x * 10 + xx) * 3
                if (!pixels.subarray(offset, offset + 3).equals(bg)) ink = true
              }
            expect(ink, `Missing glyph ${char}`).toBe(true)
          }
          x++
        }
    }
    expect(pixels).not.toEqual(renderTextScenePixels(width, height, style, 1600))
    expect(renderTextScenePixels(7, 7, style, 500)).toHaveLength(147)
  },
)
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
  const frame = createDigitalCodePixels(3840, 2160, "down", undefined, "mahjong-match")
  expect([frame.width, frame.height]).toEqual([1920, 1080])
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
