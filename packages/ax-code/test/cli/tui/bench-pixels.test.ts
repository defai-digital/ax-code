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

test.each(["midnight-dream", "sunset-serenade"] as const)(
  "%s paints the shared shoreline scene from elapsed time",
  (style) => {
    const night = style === "midnight-dream"
    const first = renderBenchPixels(WIDTH, HEIGHT, style, 0)
    const moving = renderBenchPixels(WIDTH, HEIGHT, style, 1000)
    expect(first.length).toBe(WIDTH * HEIGHT * 3)
    expect(first).not.toEqual(moving)
    expect(renderBenchPixels(WIDTH, HEIGHT, style, 1000)).toEqual(moving)
    expect(renderBenchPixels(WIDTH, HEIGHT, style, -100)).toEqual(first)
    // Sky starts at the shared background; the centered title stays clear of
    // the left edge on the bottom row while sand covers scene row 21.
    expect(pixel(first, 0, 0)).toEqual(night ? [11, 19, 43] : [52, 27, 54])
    expect(pixel(first, 0, 430)).toEqual([233, 196, 106])
    // Wave crests flip with the shared phase.
    const wave: readonly [number, number, number] = night ? [0, 180, 216] : [195, 107, 155]
    expect(pixel(first, 5, 370)).toEqual(wave)
    expect(pixel(renderBenchPixels(WIDTH, HEIGHT, style, 300), 5, 370)).not.toEqual(wave)
    // The trunk sways with the shared phase.
    const trunk: readonly [number, number, number] = night ? [183, 148, 87] : [161, 108, 80]
    expect(pixel(first, 175, 310)).toEqual(trunk)
    expect(pixel(renderBenchPixels(WIDTH, HEIGHT, style, 500), 175, 310)).not.toEqual(trunk)
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
  expect(pixel(dawn, 525, 290)).toEqual([255, 205, 117])
  expect(pixel(renderBenchPixels(WIDTH, HEIGHT, "sunset-serenade", 3000), 525, 290)).not.toEqual([255, 205, 117])
  // The settled sun stays down while the surf keeps moving.
  const settled = renderBenchPixels(WIDTH, HEIGHT, "sunset-serenade", 3000)
  expect(pixel(settled, 525, 330)).toEqual([255, 205, 117])
  expect(pixel(renderBenchPixels(WIDTH, HEIGHT, "sunset-serenade", 100000), 525, 330)).toEqual([255, 205, 117])
})

test("midnight stars twinkle with the shared phase while sunset has none", () => {
  const night = renderBenchPixels(WIDTH, HEIGHT, "midnight-dream", 0)
  expect(pixel(night, 35, 30)).toEqual([226, 234, 252])
  expect(pixel(renderBenchPixels(WIDTH, HEIGHT, "midnight-dream", 600), 35, 30)).toEqual([92, 103, 125])
  const day = renderBenchPixels(WIDTH, HEIGHT, "sunset-serenade", 0)
  expect(pixel(day, 35, 30)).not.toEqual([255, 205, 117])
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
  expect(decode(writes[0]!)).toEqual(renderTextScenePixels(740, 500, "midnight-dream", 750))
  player.draw({ ...input, width: 500, style: "sunset-serenade" })
  expect(writes[1]).toContain("a=d,d=I")
  expect(decode(writes[2]!)).toEqual(renderTextScenePixels(500, 500, "sunset-serenade", 750))
  player.dispose()
  expect(writes[3]).toContain("a=d,d=I")
  player.draw(input)
  expect(writes).toHaveLength(4)
})
