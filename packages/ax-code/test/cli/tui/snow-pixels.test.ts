import { expect, test } from "vitest"
import { inflateSync } from "node:zlib"
import { renderSnowPixels } from "../../../src/cli/tui/component/snow-pixels"
import { renderTextScenePixels } from "../../../src/cli/tui/component/text-scene-pixels"
import { createDigitalCodePixels, digitalCodePixelPlayer } from "../../../src/cli/tui/component/digital-code-pixels"

// Maps the shared 74x20 scene to exact 10x20 pixel cells.
const WIDTH = 740
const HEIGHT = 400
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["snowfall", "winter-night"] as const)("%s paints the shared forest and loops", (style) => {
  const day = style === "snowfall"
  const first = renderSnowPixels(WIDTH, HEIGHT, style, 0)
  const moving = renderSnowPixels(WIDTH, HEIGHT, style, 1500)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(first.equals(moving)).toBe(false)
  expect(first.equals(renderSnowPixels(WIDTH, HEIGHT, style, 3000))).toBe(true)
  expect(renderSnowPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  expect(pixel(first, 0, 0)).toEqual(day ? [125, 148, 184] : [12, 22, 46])
  // The orb stays fixed above the snowfall.
  const orb: readonly [number, number, number] = day ? [245, 233, 200] : [232, 238, 248]
  const at = day ? [585, 40] : [145, 40]
  expect(pixel(first, at[0]!, at[1]!)).toEqual(orb)
  expect(pixel(moving, at[0]!, at[1]!)).toEqual(orb)
  // Ground never sees a flake.
  const ground: readonly [number, number, number] = day ? [238, 243, 250] : [126, 147, 184]
  expect(pixel(first, 375, 350)).toEqual(ground)
  expect(pixel(moving, 375, 350)).toEqual(ground)
  // The tall peak fills the gap between the middle pines.
  const ridge: readonly [number, number, number] = day ? [124, 143, 180] : [44, 60, 96]
  expect(pixel(first, 335, 230)).toEqual(ridge)
  // The first ground spark glints bright, then dims.
  const snow: readonly [number, number, number] = day ? [255, 255, 255] : [223, 232, 245]
  const sparkDim: readonly [number, number, number] = day ? [174, 185, 204] : [74, 90, 120]
  expect(pixel(first, 55, 350)).toEqual(snow)
  expect(pixel(renderSnowPixels(WIDTH, HEIGHT, style, 300), 55, 350)).toEqual(sparkDim)
})

test.each(["snowfall", "winter-night"] as const)("%s halos the orb and shadows the ground", (style) => {
  const day = style === "snowfall"
  const first = renderSnowPixels(WIDTH, HEIGHT, style, 0)
  // The halo ring is neither raw sky nor orb ink.
  const sky = pixel(first, 370, 20)
  const halo = pixel(first, day ? 585 : 145, 20)
  expect(halo).not.toEqual(sky)
  expect(halo).not.toEqual(day ? [245, 233, 200] : [232, 238, 248])
  // Pine shadows pool on the ground away from the orb side.
  const shadow: readonly [number, number, number] = day ? [174, 185, 204] : [74, 90, 120]
  expect(pixel(first, 250, 350)).toEqual(shadow)
  // The third peak fills the gap between the right pines.
  const ridge: readonly [number, number, number] = day ? [124, 143, 180] : [44, 60, 96]
  expect(pixel(first, 560, 240)).toEqual(ridge)
})

test("Snow stays within the HD bound", () => {
  const frame = createDigitalCodePixels(3840, 2160, "down", undefined, "snowfall")
  expect([frame.width, frame.height]).toEqual([1920, 1080])
})

test.each(["snowfall", "winter-night"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderSnowPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})

test("Snow transmits its own pixels and cleans up on resize", () => {
  const writes: string[] = []
  const player = digitalCodePixelPlayer((data) => writes.push(data))
  const input = {
    width: 740,
    height: 400,
    columns: 80,
    rows: 24,
    direction: "down" as const,
    style: "snowfall" as const,
    elapsedMs: 750,
  }
  const decode = (output: string) =>
    inflateSync(
      Buffer.from([...output.matchAll(/\x1b_G[^;]+;([A-Za-z0-9+/=]*)\x1b\\/g)].map((m) => m[1]).join(""), "base64"),
    )
  player.draw(input)
  expect(decode(writes[0]!).equals(renderTextScenePixels(740, 400, "snowfall", 750))).toBe(true)
  player.draw({ ...input, width: 600, style: "winter-night" })
  expect(writes[1]).toContain("a=d,d=I")
  expect(decode(writes[2]!).equals(renderTextScenePixels(600, 400, "winter-night", 750))).toBe(true)
  player.dispose()
  expect(writes[3]).toContain("a=d,d=I")
  player.draw(input)
  expect(writes).toHaveLength(4)
})
