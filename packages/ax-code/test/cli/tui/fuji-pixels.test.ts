import { expect, test } from "vitest"
import { inflateSync } from "node:zlib"
import { renderFujiPixels } from "../../../src/cli/tui/component/fuji-pixels"
import { createDigitalCodePixels, digitalCodePixelPlayer } from "../../../src/cli/tui/component/digital-code-pixels"

const pixel = (frame: Buffer, width: number, x: number, y: number) => [
  ...frame.subarray((y * width + x) * 3, (y * width + x) * 3 + 3),
]
const countColor = (frame: Buffer, rgb: readonly [number, number, number]) => {
  let found = 0
  for (let i = 0; i < frame.length; i += 3) {
    if (frame[i] === rgb[0] && frame[i + 1] === rgb[1] && frame[i + 2] === rgb[2]) found++
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
    expect(first).not.toEqual(moving)
    expect(first).toEqual(renderFujiPixels(780, 440, style, 2400))
    // Sky corners match the shared gradient.
    expect(pixel(first, 780, 0, 0)).toEqual(style === "fuji-day" ? [120, 35, 110] : [16, 27, 54])
    expect(pixel(first, 780, 0, 439)).toEqual(style === "fuji-day" ? [242, 166, 94] : [29, 53, 87])
    // Celestial bodies sit above the petal zone, so their centers never move.
    const orb =
      style === "fuji-day"
        ? { at: [390, 26] as const, color: [255, 230, 109] }
        : { at: [590, 18] as const, color: [226, 234, 252] }
    expect(pixel(first, 780, orb.at[0], orb.at[1])).toEqual(orb.color)
    expect(pixel(moving, 780, orb.at[0], orb.at[1])).toEqual(orb.color)
    // Mountain face and reflection column are static and petal-free here.
    expect(pixel(first, 780, 316, 165)).toEqual(style === "fuji-day" ? [176, 122, 136] : [45, 68, 84])
    expect(pixel(moving, 780, 316, 165)).toEqual(style === "fuji-day" ? [176, 122, 136] : [45, 68, 84])
    const rx = style === "fuji-day" ? 395 : 595
    expect(pixel(first, 780, rx, 242)).toEqual(style === "fuji-day" ? [255, 180, 107] : [203, 213, 225])
    expect(pixel(moving, 780, rx, 242)).toEqual(style === "fuji-day" ? [255, 180, 107] : [203, 213, 225])
    // The lake shimmers (two full waves per cycle) but the frame still loops.
    expect(pixel(first, 780, 158, 231)).toEqual(style === "fuji-day" ? [160, 91, 112] : [46, 71, 105])
    expect(pixel(shimmer, 780, 158, 231)).not.toEqual(pixel(first, 780, 158, 231))
    // The shinkansen body is absent at cycle start and fully present midway.
    const pearl: readonly [number, number, number] = [237, 242, 244]
    expect(countColor(first, pearl)).toBe(0)
    expect(countColor(moving, pearl)).toBeGreaterThan(2000)
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
