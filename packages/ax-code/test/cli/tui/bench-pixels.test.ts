import { expect, test } from "vitest"
import { inflateSync } from "node:zlib"
import { benchRows } from "../../../src/cli/tui/component/bench-view-model"
import { renderTextScenePixels } from "../../../src/cli/tui/component/text-scene-pixels"
import { createDigitalCodePixels, digitalCodePixelPlayer } from "../../../src/cli/tui/component/digital-code-pixels"

test.each(["midnight-dream", "sunset-serenade"] as const)("%s rasterizes all scene glyphs and animates", (style) => {
  const width = 740,
    height = 500
  const first = renderTextScenePixels(width, height, style, 0)
  expect(first).toHaveLength(width * height * 3)
  expect([...first.subarray(0, 3)]).toEqual(style === "midnight-dream" ? [11, 19, 43] : [52, 27, 54])
  expect(first).not.toEqual(renderTextScenePixels(width, height, style, 1000))
  // Every non-space character must produce ink, including waves and titles.
  const background = first.subarray(0, 3)
  const rows = benchRows(70, 23, style, 0)
  for (let row = 0; row < rows.length; row++) {
    const text = rows[row]!.map((run) => run.text).join("")
    for (let col = 0; col < text.length; col++) {
      if (text[col] === " ") continue
      let visible = false
      for (let y = 0; y < 20; y++) {
        for (let x = 0; x < 10; x++) {
          const offset = ((row * 20 + 20 + y) * width + col * 10 + 20 + x) * 3
          if (!first.subarray(offset, offset + 3).equals(background)) visible = true
        }
      }
      expect(visible, `Missing glyph ${text[col]} at ${col},${row}`).toBe(true)
    }
  }
  for (const [w, h] of [
    [7, 7],
    [200, 800],
    [1200, 160],
  ]) {
    expect(renderTextScenePixels(w!, h!, style, 700)).toHaveLength(w! * h! * 3)
  }
})

test("Bench transmits its own pixels at bounded resolution and cleans up on resize", () => {
  const frame = createDigitalCodePixels(3840, 2160, "down", undefined, "midnight-dream")
  expect([frame.width, frame.height]).toEqual([1920, 1080])
  const writes: string[] = []
  const player = digitalCodePixelPlayer((data) => writes.push(data))
  const input = {
    width: 740,
    height: 500,
    columns: 80,
    rows: 24,
    direction: "down" as const,
    style: "midnight-dream" as const,
    elapsedMs: 750,
  }
  const decode = (output: string) =>
    inflateSync(
      Buffer.from([...output.matchAll(/\x1b_G[^;]+;([A-Za-z0-9+/=]*)\x1b\\/g)].map((m) => m[1]).join(""), "base64"),
    )
  player.draw(input)
  expect(decode(writes[0]!)).toEqual(renderTextScenePixels(740, 500, "midnight-dream", 750))
  player.draw({ ...input, width: 500, style: "sunset-serenade" })
  expect(writes[1]).toContain("a=d,d=I")
  expect(decode(writes[2]!)).toEqual(renderTextScenePixels(500, 500, "sunset-serenade", 750))
  player.dispose()
  expect(writes[3]).toContain("a=d,d=I")
  player.draw(input)
  expect(writes).toHaveLength(4)
})
