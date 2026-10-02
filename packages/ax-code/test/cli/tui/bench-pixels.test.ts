import { expect, test } from "vitest"
import { inflateSync } from "node:zlib"
import { renderBenchPixels } from "../../../src/cli/tui/component/bench-pixels"
import { renderTextScenePixels } from "../../../src/cli/tui/component/text-scene-pixels"
import { createDigitalCodePixels, digitalCodePixelPlayer } from "../../../src/cli/tui/component/digital-code-pixels"

// Maps the shared 70x23 reference to exact 10x20 pixel cells.
const WIDTH = 700
const HEIGHT = 460
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]
const countColor = (frame: Buffer, rgb: readonly [number, number, number]) => {
  let found = 0
  for (let i = 0; i < frame.length; i += 3) {
    if (frame[i] === rgb[0] && frame[i + 1] === rgb[1] && frame[i + 2] === rgb[2]) found++
  }
  return found
}

const lum = (p: number[]) => p[0]! + p[1]! + p[2]!
const changedPixels = (a: Buffer, b: Buffer, y0: number, y1: number) => {
  let count = 0
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < WIDTH; x += 2) {
      const i = (y * WIDTH + x) * 3
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) count++
    }
  }
  return count
}

test.each(["midnight-dream", "sunset-serenade"] as const)(
  "%s paints the shared shoreline scene from elapsed time",
  (style) => {
    const night = style === "midnight-dream"
    const first = renderBenchPixels(WIDTH, HEIGHT, style, 0)
    const moving = renderBenchPixels(WIDTH, HEIGHT, style, 1000)
    expect(first.length).toBe(WIDTH * HEIGHT * 3)
    expect(first.equals(moving)).toBe(false)
    expect(renderBenchPixels(WIDTH, HEIGHT, style, 1000).equals(moving)).toBe(true)
    expect(renderBenchPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
    // Sky starts at the shared background; the sand never moves.
    expect(pixel(first, 0, 0)).toEqual(night ? [12, 20, 44] : [52, 27, 54])
    expect(pixel(moving, 0, 430)).toEqual(pixel(first, 0, 430))
    expect(lum(pixel(first, 0, 430))).toBeGreaterThan(lum(pixel(first, 0, 0)))
    // The surf and glitter move: the sea band changes between frames.
    expect(changedPixels(first, moving, 330, 380)).toBeGreaterThan(300)
    // The palm sways: the crown changes while the trunk base stays put.
    expect(changedPixels(first, renderBenchPixels(WIDTH, HEIGHT, style, 500), 220, 300)).toBeGreaterThan(50)
    expect(pixel(first, 160, 410)).toEqual(pixel(renderBenchPixels(WIDTH, HEIGHT, style, 500), 160, 410))
    // Title ink is present.
    const light: readonly [number, number, number] = night ? [226, 234, 252] : [255, 205, 117]
    expect(countColor(first, light)).toBeGreaterThan(100)
  },
)

test("midnight keeps a fixed moon while the sunset descends and settles", () => {
  const moon = renderBenchPixels(WIDTH, HEIGHT, "midnight-dream", 0)
  expect(pixel(moon, 525, 70)).toEqual([226, 234, 252])
  expect(pixel(renderBenchPixels(WIDTH, HEIGHT, "midnight-dream", 5000), 525, 70)).toEqual([226, 234, 252])
  const dawn = renderBenchPixels(WIDTH, HEIGHT, "sunset-serenade", 0)
  expect(pixel(dawn, 525, 290)).toEqual([255, 227, 163])
  expect(pixel(renderBenchPixels(WIDTH, HEIGHT, "sunset-serenade", 3000), 525, 290)).not.toEqual([255, 227, 163])
  // The settled sun stays down: the sky above the horizon is identical afterwards.
  const settled = renderBenchPixels(WIDTH, HEIGHT, "sunset-serenade", 3000)
  const later = renderBenchPixels(WIDTH, HEIGHT, "sunset-serenade", 100000)
  expect(pixel(settled, 525, 250)).toEqual(pixel(later, 525, 250))
  expect(pixel(settled, 525, 300)).toEqual(pixel(later, 525, 300))
})

test("midnight stars twinkle with the shared phase while sunset has none", () => {
  const night = renderBenchPixels(WIDTH, HEIGHT, "midnight-dream", 0)
  const later = renderBenchPixels(WIDTH, HEIGHT, "midnight-dream", 600)
  expect(pixel(night, 35, 30)).not.toEqual(pixel(later, 35, 30))
  expect(lum(pixel(night, 35, 30))).toBeGreaterThan(lum(pixel(night, 40, 80)))
  const day = renderBenchPixels(WIDTH, HEIGHT, "sunset-serenade", 0)
  expect(pixel(day, 35, 30)).toEqual(pixel(renderBenchPixels(WIDTH, HEIGHT, "sunset-serenade", 600), 35, 30))
})

test("sun halo and shimmering reflection decorate both styles", () => {
  for (const style of ["midnight-dream", "sunset-serenade"] as const) {
    const first = renderBenchPixels(WIDTH, HEIGHT, style, 0)
    // The halo ring beside the body is neither raw sky nor body ink.
    const sky = pixel(first, 100, 52)
    const halo = style === "midnight-dream" ? pixel(first, 525, 20) : pixel(first, 525, 250)
    expect(halo).not.toEqual(sky)
    expect(halo).not.toEqual(style === "midnight-dream" ? [226, 234, 252] : [255, 227, 163])
    // The reflection column under the body is brighter than open water beside it and shimmers.
    const later = renderBenchPixels(WIDTH, HEIGHT, style, 300)
    expect(changedPixels(first, later, 335, 375)).toBeGreaterThan(100)
  }
})

test("sunset clouds drift while midnight keeps a clear sky", () => {
  const sunset = renderBenchPixels(WIDTH, HEIGHT, "sunset-serenade", 0)
  const drifted = renderBenchPixels(WIDTH, HEIGHT, "sunset-serenade", 4000)
  expect(pixel(sunset, 40, 80)).not.toEqual(pixel(drifted, 40, 80))
  // A cloud pixel is much brighter than the plain sky at the same height.
  expect(lum(pixel(sunset, 40, 80))).toBeGreaterThan(lum(pixel(sunset, 300, 80)) + 100)
  const night = renderBenchPixels(WIDTH, HEIGHT, "midnight-dream", 0)
  expect(lum(pixel(night, 40, 80))).toBeLessThan(150)
})

test("Bench stays within the HD bound", () => {
  const frame = createDigitalCodePixels(3840, 2160, "down", undefined, "midnight-dream")
  expect([frame.width, frame.height]).toEqual([1920, 1080])
})

test.each(["midnight-dream", "sunset-serenade"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [200, 800],
    [1200, 160],
  ]) {
    expect(renderBenchPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})

test("Bench transmits its own pixels at bounded resolution and cleans up on resize", () => {
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
  expect(decode(writes[0]!).equals(renderTextScenePixels(740, 500, "midnight-dream", 750))).toBe(true)
  player.draw({ ...input, width: 500, style: "sunset-serenade" })
  expect(writes[1]).toContain("a=d,d=I")
  expect(decode(writes[2]!).equals(renderTextScenePixels(500, 500, "sunset-serenade", 750))).toBe(true)
  player.dispose()
  expect(writes[3]).toContain("a=d,d=I")
  player.draw(input)
  expect(writes).toHaveLength(4)
})
