import { expect, test } from "vitest"
import { renderBrandenburgPixels } from "../../../src/cli/tui/component/brandenburg-pixels"
import { renderTextScenePixels } from "../../../src/cli/tui/component/text-scene-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells: one gate unit is 10 pixels,
// the gate is centered on x=380, and the ground line sits at y=380.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]
/** Pixel at a gate-unit position: x from the gate center, y up from the ground line. */
const gatePixel = (frame: Buffer, gx: number, gy: number) =>
  pixel(frame, Math.floor(380 + gx * 10), Math.floor(380 - gy * 10))
const brightness = (color: number[]) => color[0]! + color[1]! + color[2]!

test.each(["brandenburg-night", "brandenburg-dawn"] as const)(
  "%s paints deterministically from elapsed time",
  (style) => {
    const first = renderBrandenburgPixels(WIDTH, HEIGHT, style, 0)
    const moving = renderBrandenburgPixels(WIDTH, HEIGHT, style, 900)
    expect(first.length).toBe(WIDTH * HEIGHT * 3)
    expect(moving.equals(renderBrandenburgPixels(WIDTH, HEIGHT, style, 900))).toBe(true)
    expect(renderBrandenburgPixels(WIDTH, HEIGHT, style, 900).equals(moving)).toBe(true)
    expect(renderBrandenburgPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
    expect(first.equals(moving)).toBe(false)
    // The scene dispatcher routes to this renderer.
    expect(
      renderTextScenePixels(WIDTH, HEIGHT, style, 700).equals(renderBrandenburgPixels(WIDTH, HEIGHT, style, 700)),
    ).toBe(true)
  },
)

test.each(["brandenburg-night", "brandenburg-dawn"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderBrandenburgPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})

test("the night gate is warm floodlit stone under a blue sky", () => {
  const frame = renderBrandenburgPixels(WIDTH, HEIGHT, "brandenburg-night", 3000)
  // Sky at the zenith and through the central opening is blue-dominant.
  for (const [x, y] of [
    [5, 5],
    [755, 40],
    [380, 300],
  ] as const) {
    const [r, , b] = pixel(frame, x, y)
    expect(b!).toBeGreaterThan(r!)
  }
  // Shafts, frieze, attic, walls, and soffit are all red-dominant sandstone.
  for (const [gx, gy] of [
    [5.1, 10],
    [-21.4, 10],
    [0.9, 20.2],
    [-20, 25],
    [-17.4, 5],
    [0, 17],
  ] as const) {
    const [r, g, b] = gatePixel(frame, gx, gy)
    expect(r!).toBeGreaterThan(150)
    expect(r!).toBeGreaterThan(g!)
    expect(g!).toBeGreaterThan(b! + 30)
  }
  // The quadriga is green bronze against the sky.
  const [br, bg, bb] = gatePixel(frame, -4.2, 30.5)
  expect(bg!).toBeGreaterThan(br!)
  expect(bg!).toBeGreaterThan(bb! + 30)
  // Outside the gate and wings the plaza is dark stone, not sand.
  expect(brightness(pixel(frame, 380, 470))).toBeLessThan(300)
})

test("the floodlights fade up over the night opening", () => {
  const dark = renderBrandenburgPixels(WIDTH, HEIGHT, "brandenburg-night", 0)
  const lit = renderBrandenburgPixels(WIDTH, HEIGHT, "brandenburg-night", 1500)
  for (const [gx, gy] of [
    [5.1, 10],
    [0.9, 20.2],
    [-17.4, 5],
  ] as const) {
    expect(brightness(gatePixel(lit, gx, gy))).toBeGreaterThan(brightness(gatePixel(dark, gx, gy)) * 1.3)
  }
})

test("the dawn sun climbs behind the gate and shows through the center opening", () => {
  const early = renderBrandenburgPixels(WIDTH, HEIGHT, "brandenburg-dawn", 0)
  const late = renderBrandenburgPixels(WIDTH, HEIGHT, "brandenburg-dawn", 3500)
  // At full height the sun core fills the middle of the opening.
  const [r, g, b] = gatePixel(late, 0, 9)
  expect(r!).toBeGreaterThan(240)
  expect(g!).toBeGreaterThan(230)
  expect(b!).toBeGreaterThan(190)
  expect(brightness(gatePixel(late, 0, 9))).toBeGreaterThan(brightness(gatePixel(early, 0, 9)))
  // The settled frame is stable.
  expect(renderBrandenburgPixels(WIDTH, HEIGHT, "brandenburg-dawn", 3500).equals(late)).toBe(true)
  expect(renderBrandenburgPixels(WIDTH, HEIGHT, "brandenburg-dawn", 60_000).equals(late)).toBe(false)
})
