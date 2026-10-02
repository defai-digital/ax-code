import { expect, test } from "vitest"
import { renderMahjongPixels } from "../../../src/cli/tui/component/mahjong-pixels"
import { createDigitalCodePixels } from "../../../src/cli/tui/component/digital-code-pixels"

// Maps the shared 76x25 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 500
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]
const lum = (frame: Buffer, x: number, y: number) => {
  const [r, g, b] = pixel(frame, x, y)
  return 0.299 * r! + 0.587 * g! + 0.114 * b!
}
/** Share of pixels in a rectangle that look like ivory tile faces. */
const ivoryShare = (frame: Buffer, x0: number, y0: number, x1: number, y1: number) => {
  let hits = 0
  let total = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const [r, g, b] = pixel(frame, x, y)
      total++
      if (r! > 200 && g! > 215 && b! > 200) hits++
    }
  }
  return hits / total
}

test.each(["mahjong-match", "mahjong-ending"] as const)(
  "%s paints the shared felt scene and loops with the cycle",
  (style) => {
    const first = renderMahjongPixels(WIDTH, HEIGHT, style, 0)
    const moving = renderMahjongPixels(WIDTH, HEIGHT, style, 1200)
    expect(first.length).toBe(WIDTH * HEIGHT * 3)
    expect(first.equals(moving)).toBe(false)
    expect(first.equals(renderMahjongPixels(WIDTH, HEIGHT, style, 4800))).toBe(true)
    expect(renderMahjongPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
    // The table rim and inner border are static and brighter than the felt around them.
    expect(pixel(first, WIDTH / 2, 3)).toEqual(pixel(moving, WIDTH / 2, 3))
    expect(lum(first, WIDTH / 2, 3)).toBeGreaterThan(lum(first, 5, HEIGHT / 2))
    // The felt stays dark green near the corners.
    const [r, g, b] = pixel(first, 5, 5)
    expect(g!).toBeGreaterThan(r!)
    expect(g!).toBeGreaterThan(b!)
  },
)

test("match discards land on the shared layout while concealed backs stay fixed", () => {
  const first = renderMahjongPixels(WIDTH, HEIGHT, "mahjong-match", 0)
  const moving = renderMahjongPixels(WIDTH, HEIGHT, "mahjong-match", 1200)
  // South's first discard appears at scene (31, 14) once step 1 lands.
  expect(ivoryShare(first, 310, 280, 350, 300)).toBe(0)
  expect(ivoryShare(moving, 310, 280, 350, 300)).toBeGreaterThan(0.15)
  // Concealed backs never reveal tile identity, so they are step-independent.
  expect(pixel(first, 200, 90)).toEqual(pixel(moving, 200, 90))
  // The open south hand shows ivory faces from the start.
  expect(ivoryShare(first, 190, 360, 570, 380)).toBeGreaterThan(0.2)
})

test("ending keeps a static ledger with a shared blink phase", () => {
  const first = renderMahjongPixels(WIDTH, HEIGHT, "mahjong-ending", 0)
  const blink = renderMahjongPixels(WIDTH, HEIGHT, "mahjong-ending", 400)
  expect(first.equals(blink)).toBe(false)
  expect(first.equals(renderMahjongPixels(WIDTH, HEIGHT, "mahjong-ending", 4800))).toBe(true)
  // The blink marker glows gold in the lit phase only.
  expect(pixel(blink, 385, 430)).not.toEqual(pixel(first, 385, 430))
  const [r, , b] = pixel(blink, 385, 430)
  expect(r!).toBeGreaterThan(b! + 100)
})

test("match spotlights the turn seat and fills the wall bar", () => {
  const moving = renderMahjongPixels(WIDTH, HEIGHT, "mahjong-match", 1200)
  // The WEST label (scene 5,8) sits on a lit jade pill at step 3; EAST does not.
  const pill = pixel(moving, 45, 171)
  expect(pill[1]!).toBeGreaterThan(pill[0]! + 40)
  expect(lum(moving, 45, 171)).toBeGreaterThan(lum(moving, 590, 171) - 1)
  // The wall bar (scene row 22) fills 19 of 20 cells at wall 81: bright fill, dark remainder.
  expect(lum(moving, 200, 450)).toBeGreaterThan(lum(moving, 345, 450) + 40)
})

test("ending medals the winner with a gold coin", () => {
  const first = renderMahjongPixels(WIDTH, HEIGHT, "mahjong-ending", 0)
  const [r, g, b] = pixel(first, 245, 190)
  expect(r!).toBeGreaterThan(b! + 100)
  expect(g!).toBeGreaterThan(b!)
})

test("Mahjong stays within the HD bound", () => {
  const frame = createDigitalCodePixels(3840, 2160, "down", undefined, "mahjong-match")
  expect([frame.width, frame.height]).toEqual([1920, 1080])
})

test.each(["mahjong-match", "mahjong-ending"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderMahjongPixels(width!, height!, style, 1000)).toHaveLength(width! * height! * 3)
  }
})
