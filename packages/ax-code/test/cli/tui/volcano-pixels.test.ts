import { expect, test } from "vitest"
import { inflateSync } from "node:zlib"
import { renderVolcanoPixels } from "../../../src/cli/tui/component/volcano-pixels"
import { renderTextScenePixels } from "../../../src/cli/tui/component/text-scene-pixels"
import { createDigitalCodePixels, digitalCodePixelPlayer } from "../../../src/cli/tui/component/digital-code-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["volcano-eruption", "volcano-calm"] as const)("%s paints the shared cone from elapsed time", (style) => {
  const eruption = style === "volcano-eruption"
  const first = renderVolcanoPixels(WIDTH, HEIGHT, style, 0)
  const moving = renderVolcanoPixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(first).not.toEqual(moving)
  expect(renderVolcanoPixels(WIDTH, HEIGHT, style, 900)).toEqual(moving)
  expect(renderVolcanoPixels(WIDTH, HEIGHT, style, -100)).toEqual(first)
  expect(pixel(first, 0, 0)).toEqual(eruption ? [22, 10, 20] : [10, 14, 36])
  // The cone face never moves.
  const rock: readonly [number, number, number] = eruption ? [42, 22, 32] : [28, 35, 51]
  expect(pixel(first, 200, 340)).toEqual(rock)
  expect(pixel(moving, 200, 340)).toEqual(rock)
  // Ground stays clear of the flow.
  const ground: readonly [number, number, number] = eruption ? [26, 15, 22] : [17, 24, 42]
  expect(pixel(first, 100, 430)).toEqual(ground)
  expect(pixel(moving, 100, 430)).toEqual(ground)
})

test("the crater pulses while calm, lava, and smoke follow their styles", () => {
  const hot = renderVolcanoPixels(WIDTH, HEIGHT, "volcano-eruption", 0)
  expect(pixel(hot, 380, 170)).not.toEqual(pixel(renderVolcanoPixels(WIDTH, HEIGHT, "volcano-eruption", 300), 380, 170))
  const calm = renderVolcanoPixels(WIDTH, HEIGHT, "volcano-calm", 0)
  expect(pixel(calm, 380, 170)).toEqual([122, 42, 30])
  expect(pixel(renderVolcanoPixels(WIDTH, HEIGHT, "volcano-calm", 900), 380, 170)).toEqual([122, 42, 30])
  expect(pixel(hot, 445, 270)).toEqual([255, 209, 102])
  expect(pixel(calm, 445, 270)).toEqual([28, 35, 51])
  // A white-hot surge crosses the channel at rest.
  expect(pixel(hot, 450, 290)).toEqual([255, 240, 208])
  // The heat halo above the crater breathes with the pulse beat.
  expect(pixel(hot, 380, 125)).not.toEqual(pixel(renderVolcanoPixels(WIDTH, HEIGHT, "volcano-eruption", 300), 380, 125))
  // The left crater lip glows in eruption and stays bare rock in calm.
  expect(pixel(hot, 340, 170)).toEqual([255, 209, 102])
  expect(pixel(calm, 340, 170)).toEqual([61, 74, 107])
})

test("Volcano stays within the HD bound", () => {
  const frame = createDigitalCodePixels(3840, 2160, "down", undefined, "volcano-eruption")
  expect([frame.width, frame.height]).toEqual([1920, 1080])
})

test.each(["volcano-eruption", "volcano-calm"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderVolcanoPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})

test("Volcano transmits its own pixels and cleans up on resize", () => {
  const writes: string[] = []
  const player = digitalCodePixelPlayer((data) => writes.push(data))
  const input = {
    width: 760,
    height: 480,
    columns: 80,
    rows: 24,
    direction: "down" as const,
    style: "volcano-eruption" as const,
    elapsedMs: 750,
  }
  const decode = (output: string) =>
    inflateSync(
      Buffer.from([...output.matchAll(/\x1b_G[^;]+;([A-Za-z0-9+/=]*)\x1b\\/g)].map((m) => m[1]).join(""), "base64"),
    )
  player.draw(input)
  expect(decode(writes[0]!)).toEqual(renderTextScenePixels(760, 480, "volcano-eruption", 750))
  player.draw({ ...input, width: 600, style: "volcano-calm" })
  expect(writes[1]).toContain("a=d,d=I")
  expect(decode(writes[2]!)).toEqual(renderTextScenePixels(600, 480, "volcano-calm", 750))
  player.dispose()
  expect(writes[3]).toContain("a=d,d=I")
  player.draw(input)
  expect(writes).toHaveLength(4)
})
