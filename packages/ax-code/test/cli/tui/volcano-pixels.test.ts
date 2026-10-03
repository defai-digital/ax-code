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
  expect(first.equals(moving)).toBe(false)
  expect(renderVolcanoPixels(WIDTH, HEIGHT, style, 900).equals(moving)).toBe(true)
  expect(renderVolcanoPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  const sum = (p: number[]) => p.reduce((a, b) => a + b, 0)
  expect(sum(pixel(first, 0, 0))).toBeLessThan(120)
  // The cone face is dark rock lit by the style: warm in eruption, cool in calm.
  const face = pixel(first, 300, 300)
  expect(sum(face)).toBeLessThan(400)
  if (eruption) expect(face[0]!).toBeGreaterThan(face[2]!)
  else expect(face[2]!).toBeGreaterThan(face[0]!)
  // Ground away from the flow never moves.
  expect(pixel(moving, 100, 460)).toEqual(pixel(first, 100, 460))
  expect(pixel(first, 100, 460)[0]!).toBeLessThan(60)
})

test("the crater pulses while calm, lava, and smoke follow their styles", () => {
  const hot = renderVolcanoPixels(WIDTH, HEIGHT, "volcano-eruption", 0)
  expect(pixel(hot, 380, 170)).not.toEqual(pixel(renderVolcanoPixels(WIDTH, HEIGHT, "volcano-eruption", 300), 380, 170))
  const calm = renderVolcanoPixels(WIDTH, HEIGHT, "volcano-calm", 0)
  // The calm crater is a dim ember; the eruption crater burns far brighter.
  expect(calm[(170 * WIDTH + 380) * 3]!).toBeGreaterThan(calm[(170 * WIDTH + 380) * 3 + 2]!)
  expect(pixel(hot, 380, 172)[0]!).toBeGreaterThan(pixel(calm, 380, 172)[0]! + 15)
  // A lava river runs down the flank in eruption only.
  expect(pixel(hot, 436, 300)[0]!).toBeGreaterThan(200)
  expect(pixel(calm, 436, 300)[0]!).toBeLessThan(110)
  // The ash column and heat glow above the crater breathe with time.
  expect(pixel(hot, 380, 125)).not.toEqual(pixel(renderVolcanoPixels(WIDTH, HEIGHT, "volcano-eruption", 300), 380, 125))
  // Calm is cool-lit, eruption is warm-lit, at the same flank point.
  const flank = pixel(hot, 300, 300)
  expect(flank[0]!).toBeGreaterThan(flank[2]!)
  const calmFlank = pixel(calm, 300, 300)
  expect(calmFlank[2]!).toBeGreaterThan(calmFlank[0]!)
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
  expect(decode(writes[0]!).equals(renderTextScenePixels(760, 480, "volcano-eruption", 750))).toBe(true)
  player.draw({ ...input, width: 600, style: "volcano-calm" })
  expect(writes[1]).toContain("a=d,d=I")
  expect(decode(writes[2]!).equals(renderTextScenePixels(600, 480, "volcano-calm", 750))).toBe(true)
  player.dispose()
  expect(writes[3]).toContain("a=d,d=I")
  player.draw(input)
  expect(writes).toHaveLength(4)
})
