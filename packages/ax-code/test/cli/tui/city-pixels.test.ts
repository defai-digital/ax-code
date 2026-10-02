import { expect, test } from "vitest"
import { inflateSync } from "node:zlib"
import { renderCityPixels } from "../../../src/cli/tui/component/city-pixels"
import { renderTextScenePixels } from "../../../src/cli/tui/component/text-scene-pixels"
import { createDigitalCodePixels, digitalCodePixelPlayer } from "../../../src/cli/tui/component/digital-code-pixels"

// Maps the shared 72x24 scene to exact 10x20 pixel cells.
const WIDTH = 720
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]
const countWarm = (frame: Buffer) => {
  let found = 0
  for (let i = 0; i < frame.length; i += 3) {
    if (frame[i]! > 220 && frame[i + 1]! > 160 && frame[i + 2]! < 190) found++
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
  // The zenith is the darkest sky; the horizon behind the skyline is lighter.
  const sum = (p: number[]) => p[0]! + p[1]! + p[2]!
  expect(sum(pixel(first, 5, 2))).toBeLessThan(sum(pixel(first, 5, 330)))
  // The orb sits above the skyline and is the brightest thing near it.
  const orb = pixel(first, night ? 600 : 120, night ? 40 : 60)
  expect(sum(orb)).toBeGreaterThan(600)
  // Building zero window (0,0) flips with the twinkle phase: lit is warm and bright, dim is dark and cool.
  const litWindow = pixel(first, 22, 290)
  const dimWindow = pixel(moving, 22, 290)
  expect(litWindow[0]).toBeGreaterThan(litWindow[2]! + 60)
  expect(sum(litWindow)).toBeGreaterThan(sum(dimWindow) + 150)
  // Building bodies never move and are not sky.
  expect(pixel(moving, 35, 390)).toEqual(pixel(first, 35, 390))
  expect(pixel(first, 35, 390)).not.toEqual(pixel(first, 5, 330))
  expect(countWarm(first)).toBeGreaterThan(200)
  // The tallest-tower beacon blinks red above the roofline.
  const beaconOn = pixel(first, 685, 70)
  const beaconOff = pixel(moving, 685, 70)
  expect(beaconOn[0]).toBeGreaterThan(beaconOn[1]! + 100)
  expect(beaconOff[0]).toBeLessThan(beaconOn[0]!)
  // The eastbound car's headlight glows on the street at t=1000.
  const street = renderCityPixels(WIDTH, HEIGHT, style, 1000)
  expect(sum(pixel(street, 185, 470))).toBeGreaterThan(sum(pixel(first, 400, 475)))
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
