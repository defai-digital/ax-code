import { expect, test } from "vitest"
import { inflateSync } from "node:zlib"
import { renderFujiPixels } from "../../../src/cli/tui/component/fuji-pixels"
import { createDigitalCodePixels, digitalCodePixelPlayer } from "../../../src/cli/tui/component/digital-code-pixels"

test.each(["fuji-day", "fuji-night"] as const)("%s keeps the sky fixed while the train moves and loops", (style) => {
  const first = renderFujiPixels(780, 440, style, 0)
  const moving = renderFujiPixels(780, 440, style, 1200)
  expect(first.length).toBe(780 * 440 * 3)
  expect(first.subarray(0, 340 * 780 * 3)).toEqual(moving.subarray(0, 340 * 780 * 3))
  expect(first).not.toEqual(moving)
  expect(first).toEqual(renderFujiPixels(780, 440, style, 2400))
  expect([...first.subarray(0, 3)]).toEqual(style === "fuji-day" ? [168, 218, 220] : [16, 27, 54])
  // The train background remains the original deep blue, including blank cells.
  expect(moving.includes(Buffer.from([29, 53, 87]))).toBe(true)
})

test("Fuji retains higher resolution without changing Digital Code bounds", () => {
  const fuji = createDigitalCodePixels(3840, 2160, "down", undefined, "fuji-day")
  const code = createDigitalCodePixels(3840, 2160, "down")
  expect([fuji.width, fuji.height]).toEqual([1920, 1080])
  expect([code.width, code.height]).toEqual([1280, 720])
  for (const [width, height] of [
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderFujiPixels(width!, height!, "fuji-night", 1000)).toHaveLength(width! * height! * 3)
  }
})

test("Fuji transport sends the scene, preserves animation time on resize, and deletes its image", () => {
  const writes: string[] = []
  const player = digitalCodePixelPlayer((data) => writes.push(data))
  const input = {
    width: 780,
    height: 440,
    columns: 80,
    rows: 24,
    direction: "down" as const,
    style: "fuji-day" as const,
    elapsedMs: 1200,
  }
  const decode = (output: string) =>
    inflateSync(
      Buffer.from([...output.matchAll(/\x1b_G[^;]+;([A-Za-z0-9+/=]*)\x1b\\/g)].map((m) => m[1]).join(""), "base64"),
    )
  player.draw(input)
  expect(decode(writes[0]!)).toEqual(renderFujiPixels(780, 440, "fuji-day", 1200))
  player.draw({ ...input, width: 600 })
  expect(writes[1]).toContain("a=d,d=I")
  expect(decode(writes[2]!)).toEqual(renderFujiPixels(600, 440, "fuji-day", 1200))
  player.draw({ ...input, style: "fuji-night" })
  expect(decode(writes[4]!)).toEqual(renderFujiPixels(780, 440, "fuji-night", 1200))
  player.dispose()
  expect(writes[5]).toContain("a=d,d=I")
  player.draw(input)
  expect(writes).toHaveLength(6)
})
