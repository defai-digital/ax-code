import { expect, test } from "vitest"
import { inflateSync } from "node:zlib"
import { renderFestivalPixels } from "../../../src/cli/tui/component/festival-pixels"
import { renderTextScenePixels } from "../../../src/cli/tui/component/text-scene-pixels"
import { createDigitalCodePixels, digitalCodePixelPlayer } from "../../../src/cli/tui/component/digital-code-pixels"

// Maps the shared 76x25 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 500
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]
const countColor = (frame: Buffer, rgb: readonly [number, number, number]) => {
  let found = 0
  for (let i = 0; i < frame.length; i += 3) {
    if (frame[i] === rgb[0] && frame[i + 1] === rgb[1] && frame[i + 2] === rgb[2]) found++
  }
  return found
}

test.each(["festival-fireworks", "festival-lanterns"] as const)(
  "%s paints the shared sky and loops with the cycle",
  (style) => {
    const fireworks = style === "festival-fireworks"
    const first = renderFestivalPixels(WIDTH, HEIGHT, style, 0)
    const moving = renderFestivalPixels(WIDTH, HEIGHT, style, 900)
    expect(first.length).toBe(WIDTH * HEIGHT * 3)
    expect(first.equals(moving)).toBe(false)
    expect(first.equals(renderFestivalPixels(WIDTH, HEIGHT, style, 3600))).toBe(true)
    expect(renderFestivalPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
    expect(pixel(first, 0, 0)).toEqual(fireworks ? [5, 5, 16] : [10, 16, 48])
    // Town lights burn on row 22.
    expect(pixel(first, 385, 450)).toEqual([255, 209, 102])
  },
)

test("bursts bloom and fade around the shared cycle", () => {
  const first = renderFestivalPixels(WIDTH, HEIGHT, "festival-fireworks", 0)
  expect(pixel(first, 185, 190)).toEqual([255, 242, 204])
  expect(pixel(renderFestivalPixels(WIDTH, HEIGHT, "festival-fireworks", 1800), 185, 190)).not.toEqual([255, 242, 204])
  // Bursts never reach the town row.
  expect(pixel(first, 385, 450)).toEqual([255, 209, 102])
  expect(pixel(renderFestivalPixels(WIDTH, HEIGHT, "festival-fireworks", 1800), 385, 450)).toEqual([255, 209, 102])
  // Burst two lifts its rocket off the town row at t=1800.
  expect(pixel(renderFestivalPixels(WIDTH, HEIGHT, "festival-fireworks", 1800), 585, 450)).toEqual([255, 242, 204])
  expect(pixel(first, 585, 450)).not.toEqual([255, 242, 204])
})

test("lanterns rise past a fixed moon", () => {
  const first = renderFestivalPixels(WIDTH, HEIGHT, "festival-lanterns", 0)
  expect(pixel(first, 505, 50)).toEqual([232, 236, 248])
  expect(pixel(renderFestivalPixels(WIDTH, HEIGHT, "festival-lanterns", 1800), 505, 50)).toEqual([232, 236, 248])
  const core: readonly [number, number, number] = [255, 230, 179]
  expect(countColor(first, core)).toBeGreaterThan(30)
  // Flames die down together at t=200 while the dark caps stay on.
  expect(countColor(renderFestivalPixels(WIDTH, HEIGHT, "festival-lanterns", 200), core)).toBe(0)
  expect(countColor(first, [36, 22, 16])).toBeGreaterThan(0)
})

test("Festival stays within the HD bound", () => {
  const frame = createDigitalCodePixels(3840, 2160, "down", undefined, "festival-fireworks")
  expect([frame.width, frame.height]).toEqual([1920, 1080])
})

test.each(["festival-fireworks", "festival-lanterns"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderFestivalPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})

test("Festival transmits its own pixels and cleans up on resize", () => {
  const writes: string[] = []
  const player = digitalCodePixelPlayer((data) => writes.push(data))
  const input = {
    width: 760,
    height: 500,
    columns: 80,
    rows: 24,
    direction: "down" as const,
    style: "festival-fireworks" as const,
    elapsedMs: 750,
  }
  const decode = (output: string) =>
    inflateSync(
      Buffer.from([...output.matchAll(/\x1b_G[^;]+;([A-Za-z0-9+/=]*)\x1b\\/g)].map((m) => m[1]).join(""), "base64"),
    )
  player.draw(input)
  expect(decode(writes[0]!).equals(renderTextScenePixels(760, 500, "festival-fireworks", 750))).toBe(true)
  player.draw({ ...input, width: 600, style: "festival-lanterns" })
  expect(writes[1]).toContain("a=d,d=I")
  expect(decode(writes[2]!).equals(renderTextScenePixels(600, 500, "festival-lanterns", 750))).toBe(true)
  player.dispose()
  expect(writes[3]).toContain("a=d,d=I")
  player.draw(input)
  expect(writes).toHaveLength(4)
})
