import { expect, test } from "vitest"
import { inflateSync } from "node:zlib"
import { renderCityPixels } from "../../../src/cli/tui/component/city-pixels"
import { renderTextScenePixels } from "../../../src/cli/tui/component/text-scene-pixels"
import { createDigitalCodePixels, digitalCodePixelPlayer } from "../../../src/cli/tui/component/digital-code-pixels"

// Maps the shared 72x24 scene to exact 10x20 pixel cells.
const WIDTH = 720
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]
const countColor = (frame: Buffer, rgb: readonly [number, number, number]) => {
  let found = 0
  for (let i = 0; i < frame.length; i += 3) {
    if (frame[i] === rgb[0] && frame[i + 1] === rgb[1] && frame[i + 2] === rgb[2]) found++
  }
  return found
}

test.each(["city-night", "city-dawn"] as const)("%s paints the shared skyline from elapsed time", (style) => {
  const night = style === "city-night"
  const first = renderCityPixels(WIDTH, HEIGHT, style, 0)
  const moving = renderCityPixels(WIDTH, HEIGHT, style, 600)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(first.equals(moving)).toBe(false)
  expect(renderCityPixels(WIDTH, HEIGHT, style, 600).equals(moving)).toBe(true)
  expect(renderCityPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  expect(pixel(first, 0, 0)).toEqual(night ? [10, 14, 39] : [43, 27, 77])
  expect(pixel(first, 10, 450)).toEqual(night ? [13, 17, 40] : [42, 31, 61])
  // The orb sits above the skyline.
  const orb: readonly [number, number, number] = night ? [232, 236, 248] : [255, 207, 110]
  expect(pixel(first, night ? 600 : 120, night ? 40 : 60)).toEqual(orb)
  // Building zero window (0,0) flips with the twinkle phase.
  const lit: readonly [number, number, number] = night ? [255, 209, 102] : [255, 230, 163]
  const dim: readonly [number, number, number] = night ? [58, 70, 104] : [90, 74, 104]
  expect(pixel(first, 25, 290)).toEqual(lit)
  expect(pixel(moving, 25, 290)).toEqual(dim)
  // Building bodies never move.
  const body: readonly [number, number, number] = night ? [20, 26, 56] : [36, 26, 58]
  expect(pixel(first, 35, 390)).toEqual(body)
  expect(pixel(moving, 35, 390)).toEqual(body)
  expect(countColor(first, lit)).toBeGreaterThan(200)
  // Tower crowns carry a lighter shade band.
  const shade: readonly [number, number, number] = night ? [31, 40, 76] : [71, 50, 85]
  expect(pixel(first, 35, 270)).toEqual(shade)
  // The tallest-tower beacon blinks red above the roofline.
  expect(pixel(first, 685, 70)).toEqual([255, 82, 82])
  expect(pixel(moving, 685, 70)).toEqual([122, 46, 46])
  // The eastbound car head crosses column 18 at t=1000.
  expect(pixel(renderCityPixels(WIDTH, HEIGHT, style, 1000), 185, 470)).toEqual([255, 246, 218])
})

test("City stays within the HD bound", () => {
  const frame = createDigitalCodePixels(3840, 2160, "down", undefined, "city-night")
  expect([frame.width, frame.height]).toEqual([1920, 1080])
})

test.each(["city-night", "city-dawn"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderCityPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})

test("City transmits its own pixels and cleans up on resize", () => {
  const writes: string[] = []
  const player = digitalCodePixelPlayer((data) => writes.push(data))
  const input = {
    width: 720,
    height: 480,
    columns: 80,
    rows: 24,
    direction: "down" as const,
    style: "city-night" as const,
    elapsedMs: 750,
  }
  const decode = (output: string) =>
    inflateSync(
      Buffer.from([...output.matchAll(/\x1b_G[^;]+;([A-Za-z0-9+/=]*)\x1b\\/g)].map((m) => m[1]).join(""), "base64"),
    )
  player.draw(input)
  expect(decode(writes[0]!).equals(renderTextScenePixels(720, 480, "city-night", 750))).toBe(true)
  player.draw({ ...input, width: 600, style: "city-dawn" })
  expect(writes[1]).toContain("a=d,d=I")
  expect(decode(writes[2]!).equals(renderTextScenePixels(600, 480, "city-dawn", 750))).toBe(true)
  player.dispose()
  expect(writes[3]).toContain("a=d,d=I")
  player.draw(input)
  expect(writes).toHaveLength(4)
})
