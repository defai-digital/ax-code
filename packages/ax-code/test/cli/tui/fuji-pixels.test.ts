import { expect, test } from "vitest"
import { inflateSync } from "node:zlib"
import { renderFujiPixels } from "../../../src/cli/tui/component/fuji-pixels"
import { createDigitalCodePixels, digitalCodePixelPlayer } from "../../../src/cli/tui/component/digital-code-pixels"

const pixel = (frame: Buffer, width: number, x: number, y: number) => [
  ...frame.subarray((y * width + x) * 3, (y * width + x) * 3 + 3),
]
/** Number of pixels that differ between two frames inside rows [y0, y1). */
const diffRows = (a: Buffer, b: Buffer, width: number, y0: number, y1: number) => {
  let found = 0
  for (let i = y0 * width * 3; i < y1 * width * 3; i += 3) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) found++
  }
  return found
}

test.each(["fuji-day", "fuji-night"] as const)(
  "%s paints the shared scene and loops train, petals, and shimmer",
  (style) => {
    const first = renderFujiPixels(780, 440, style, 0)
    const moving = renderFujiPixels(780, 440, style, 1200)
    const shimmer = renderFujiPixels(780, 440, style, 600)
    expect(first.length).toBe(780 * 440 * 3)
    expect(first.equals(moving)).toBe(false)
    expect(first.equals(renderFujiPixels(780, 440, style, 2400))).toBe(true)
    // The top-left sky corner matches the shared gradient.
    expect(pixel(first, 780, 0, 0)).toEqual(style === "fuji-day" ? [90, 32, 78] : [16, 27, 54])
    // Celestial bodies sit above the petal zone, so their centers never move.
    const orb =
      style === "fuji-day"
        ? { at: [390, 26] as const, color: [245, 215, 142] }
        : { at: [590, 18] as const, color: [226, 234, 252] }
    expect(pixel(first, 780, orb.at[0], orb.at[1])).toEqual(orb.color)
    expect(pixel(moving, 780, orb.at[0], orb.at[1])).toEqual(orb.color)
    // A lit snow-free slope sample is static and petal-free here.
    expect(pixel(first, 780, 316, 165)).toEqual(style === "fuji-day" ? [124, 75, 88] : [75, 107, 116])
    expect(pixel(moving, 780, 316, 165)).toEqual(style === "fuji-day" ? [124, 75, 88] : [75, 107, 116])
    // The snow cap is lighter than the slope below it, and the sky stays above the peak.
    const lum = (rgb: number[]) => rgb[0]! + rgb[1]! + rgb[2]!
    expect(lum(pixel(first, 780, 390, 120))).toBeGreaterThan(lum(pixel(first, 780, 316, 165)))
    // The lake shimmers (rows 10-12.4 of the scene) but the frame still loops.
    const lake = (frame: Buffer) => diffRows(first, frame, 780, 220, 270)
    expect(lake(shimmer)).toBeGreaterThan(500)
    expect(lake(renderFujiPixels(780, 440, style, 2400))).toBe(0)
    // The shinkansen occupies the lower rows only once it has entered.
    expect(diffRows(first, moving, 780, 340, 440)).toBeGreaterThan(2000)
    // Night frames are darker than day frames overall.
    const mean = (frame: Buffer) => frame.reduce((sum, v) => sum + v, 0) / frame.length
    expect(mean(renderFujiPixels(780, 440, "fuji-night", 0))).toBeLessThan(
      mean(renderFujiPixels(780, 440, "fuji-day", 0)),
    )
  },
)

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
  expect(decode(writes[0]!).equals(renderFujiPixels(780, 440, "fuji-day", 1200))).toBe(true)
  player.draw({ ...input, width: 600 })
  expect(writes[1]).toContain("a=d,d=I")
  expect(decode(writes[2]!).equals(renderFujiPixels(600, 440, "fuji-day", 1200))).toBe(true)
  player.draw({ ...input, style: "fuji-night" })
  expect(decode(writes[4]!).equals(renderFujiPixels(780, 440, "fuji-night", 1200))).toBe(true)
  player.dispose()
  expect(writes[5]).toContain("a=d,d=I")
  player.draw(input)
  expect(writes).toHaveLength(6)
})
