import { expect, test } from "vitest"
import { inflateSync } from "node:zlib"
import { renderSnowPixels } from "../../../src/cli/tui/component/snow-pixels"
import { renderTextScenePixels } from "../../../src/cli/tui/component/text-scene-pixels"
import { createDigitalCodePixels, digitalCodePixelPlayer } from "../../../src/cli/tui/component/digital-code-pixels"

// Maps the shared 74x20 scene to exact 10x20 pixel cells.
const WIDTH = 740
const HEIGHT = 400
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

const lum = (frame: Buffer, x: number, y: number) => {
  const [r, g, b] = pixel(frame, x, y)
  return 0.299 * r! + 0.587 * g! + 0.114 * b!
}

test.each(["snowfall", "winter-night"] as const)("%s paints the shared forest and loops", (style) => {
  const day = style === "snowfall"
  const first = renderSnowPixels(WIDTH, HEIGHT, style, 0)
  const moving = renderSnowPixels(WIDTH, HEIGHT, style, 1500)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(first.equals(moving)).toBe(false)
  expect(first.equals(renderSnowPixels(WIDTH, HEIGHT, style, 3000))).toBe(true)
  expect(renderSnowPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  // Snowy ground is far brighter than the sky above the trees at night and slightly so by day.
  expect(lum(first, 375, 395)).toBeGreaterThan(lum(first, 370, 20) + (day ? 40 : 90))
  // Pines stay put: a bough low on the second pine is dark green in both frames.
  for (const frame of [first, moving]) {
    const [r, g, b] = pixel(frame, 262, 270)
    expect(g!).toBeGreaterThan(r!)
    expect(g!).toBeGreaterThan(b! - 20)
  }
  // The first ground spark glints, then dims on the next beat.
  expect(pixel(renderSnowPixels(WIDTH, HEIGHT, style, 300), 55, 350)).not.toEqual(pixel(first, 55, 350))
})

test.each(["snowfall", "winter-night"] as const)("%s halos the orb and lights the cabin", (style) => {
  const day = style === "snowfall"
  const first = renderSnowPixels(WIDTH, HEIGHT, style, 0)
  // The orb and its halo outshine the sky far from it.
  const at = day ? [585, 40] : [145, 40]
  expect(lum(first, at[0]!, at[1]!)).toBeGreaterThan(lum(first, day ? 150 : 600, 40) + 40)
  // The cabin window glows warm only at night.
  const [r, , b] = pixel(first, 357, 275)
  if (day) expect(b!).toBeGreaterThanOrEqual(r!)
  else expect(r!).toBeGreaterThan(b! + 80)
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
