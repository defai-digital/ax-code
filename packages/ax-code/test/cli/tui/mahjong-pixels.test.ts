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
    // The table rim is steady (the lamp and confetti only nudge it) and brighter than the felt around them.
    expect(Math.abs(lum(first, 14, HEIGHT / 2) - lum(moving, 14, HEIGHT / 2))).toBeLessThan(8)
    expect(lum(first, 14, HEIGHT / 2)).toBeGreaterThan(lum(first, 5, HEIGHT / 2))
    // The felt stays dark green near the corners.
    const [r, g, b] = pixel(first, 5, 5)
    expect(g!).toBeGreaterThan(r!)
    expect(g!).toBeGreaterThan(b!)
  },
)

test("match discards land in the pond and the south hand shows large ivory faces", () => {
  const first = renderMahjongPixels(WIDTH, HEIGHT, "mahjong-match", 0)
  const landed = renderMahjongPixels(WIDTH, HEIGHT, "mahjong-match", 1560)
  // South's first discard rests at scene (31, 15) once the throw has landed.
  expect(ivoryShare(first, 312, 304, 332, 322)).toBe(0)
  expect(ivoryShare(landed, 312, 304, 332, 322)).toBeGreaterThan(0.3)
  // Concealed north tiles are jade backs capped with an ivory edge, never faces.
  const [r, g] = pixel(landed, 235, 100)
  expect(g!).toBeGreaterThan(r! + 30)
  expect(ivoryShare(landed, 192, 100, 586, 118)).toBe(0)
  // The south hand is a row of tall ivory tiles, each at least 1.5 cells tall.
  expect(ivoryShare(landed, 192, 366, 580, 400)).toBeGreaterThan(0.45)
  expect(ivoryShare(landed, 192, 366, 220, 400)).toBeGreaterThan(0.5)
})

test("match throws arc through the air before landing", () => {
  // Step 3 (1200ms) starts a north throw; mid-flight the tile is not yet in its pond slot.
  const start = renderMahjongPixels(WIDTH, HEIGHT, "mahjong-match", 1200)
  const mid = renderMahjongPixels(WIDTH, HEIGHT, "mahjong-match", 1300)
  const end = renderMahjongPixels(WIDTH, HEIGHT, "mahjong-match", 1560)
  expect(start.equals(mid)).toBe(false)
  expect(mid.equals(end)).toBe(false)
  expect(ivoryShare(mid, 312, 144, 332, 162)).toBeLessThan(ivoryShare(end, 312, 144, 332, 162))
})

test("ending flips the winning hand face up and bursts into gold", () => {
  const backs = renderMahjongPixels(WIDTH, HEIGHT, "mahjong-ending", 0)
  const faces = renderMahjongPixels(WIDTH, HEIGHT, "mahjong-ending", 3000)
  const handShare = (frame: Buffer) => ivoryShare(frame, 164, 104, 560, 146)
  expect(handShare(faces)).toBeGreaterThan(0.4)
  expect(handShare(faces)).toBeGreaterThan(handShare(backs) + 0.25)
  // A flip is in flight halfway through the stagger.
  const mid = renderMahjongPixels(WIDTH, HEIGHT, "mahjong-ending", 700)
  expect(mid.equals(backs)).toBe(false)
  expect(mid.equals(faces)).toBe(false)
  // Gold light blooms behind the hand after the reveal but not before it.
  const warmth = (frame: Buffer) => {
    const [r, , b] = pixel(frame, 100, 170)
    return r! - b!
  }
  expect(warmth(faces)).toBeGreaterThan(warmth(backs))
})

test("ending keeps a static ledger with a shared blink phase", () => {
  const first = renderMahjongPixels(WIDTH, HEIGHT, "mahjong-ending", 0)
  const blink = renderMahjongPixels(WIDTH, HEIGHT, "mahjong-ending", 400)
  expect(first.equals(blink)).toBe(false)
  expect(first.equals(renderMahjongPixels(WIDTH, HEIGHT, "mahjong-ending", 4800))).toBe(true)
  // The blink marker glows gold in the lit phase only.
  expect(pixel(blink, 385, 450)).not.toEqual(pixel(first, 385, 450))
  const [r, , b] = pixel(blink, 385, 450)
  expect(r!).toBeGreaterThan(b! + 100)
})

test("match spotlights the turn seat and fills the wall bar", () => {
  const moving = renderMahjongPixels(WIDTH, HEIGHT, "mahjong-match", 1200)
  // The WEST label (scene 5,6) sits on a lit jade pill at step 3; EAST does not.
  const pill = pixel(moving, 45, 130)
  expect(pill[1]!).toBeGreaterThan(pill[0]! + 40)
  expect(lum(moving, 45, 130)).toBeGreaterThan(lum(moving, 655, 130))
  // The wall bar (scene row 22) fills 19 of 20 cells at wall 81: bright fill, dark remainder.
  expect(lum(moving, 200, 450)).toBeGreaterThan(lum(moving, 345, 450) + 40)
})

test("the wall ring shrinks as tiles are drawn", () => {
  const stacks = (frame: Buffer) => ivoryShare(frame, 270, 284, 500, 292)
  const full = renderMahjongPixels(WIDTH, HEIGHT, "mahjong-match", 0)
  // Step 9 has drawn nine tiles, so the ring has lost stacks from its tail.
  const drawn = renderMahjongPixels(WIDTH, HEIGHT, "mahjong-match", 3800)
  expect(stacks(drawn)).toBeLessThanOrEqual(stacks(full))
})

test("match dealer chip and center plate stay on the table", () => {
  const frame = renderMahjongPixels(WIDTH, HEIGHT, "mahjong-match", 1560)
  // Gold dealer chip beside the south label at scene (45.5, 17.5).
  const [r, , b] = pixel(frame, 455, 350)
  expect(r!).toBeGreaterThan(b! + 80)
  // Two ivory dice rest on the plate.
  expect(ivoryShare(frame, 367, 250, 381, 264)).toBeGreaterThan(0.25)
  expect(ivoryShare(frame, 399, 250, 413, 264)).toBeGreaterThan(0.25)
})

test("ending medals the winner with a gold coin", () => {
  const first = renderMahjongPixels(WIDTH, HEIGHT, "mahjong-ending", 0)
  const [r, g, b] = pixel(first, 245, 250)
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
