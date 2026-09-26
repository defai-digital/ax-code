import { expect, test } from "vitest"
import { renderMahjongPixels } from "../../../src/cli/tui/component/mahjong-pixels"
import { createDigitalCodePixels } from "../../../src/cli/tui/component/digital-code-pixels"

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

test.each(["mahjong-match", "mahjong-ending"] as const)(
  "%s paints the shared felt scene and loops with the cycle",
  (style) => {
    const first = renderMahjongPixels(WIDTH, HEIGHT, style, 0)
    const moving = renderMahjongPixels(WIDTH, HEIGHT, style, 1200)
    expect(first.length).toBe(WIDTH * HEIGHT * 3)
    expect(first).not.toEqual(moving)
    expect(first).toEqual(renderMahjongPixels(WIDTH, HEIGHT, style, 4800))
    expect(renderMahjongPixels(WIDTH, HEIGHT, style, -100)).toEqual(first)
    // Felt gradient endpoints match the shared palette.
    expect(pixel(first, 0, 0)).toEqual([4, 47, 34])
    expect(pixel(first, 0, HEIGHT - 1)).toEqual([2, 26, 18])
    // The table frame is static across the animation.
    expect(pixel(first, WIDTH / 2, 1)).toEqual([5, 150, 105])
    expect(pixel(moving, WIDTH / 2, 1)).toEqual([5, 150, 105])
  },
)

test("match discards land on the shared layout while concealed backs stay fixed", () => {
  const first = renderMahjongPixels(WIDTH, HEIGHT, "mahjong-match", 0)
  const moving = renderMahjongPixels(WIDTH, HEIGHT, "mahjong-match", 1200)
  // South's first discard appears at scene (31, 14) once step 1 lands.
  expect(pixel(first, 315, 285)).not.toEqual([236, 253, 245])
  expect(pixel(moving, 315, 285)).toEqual([236, 253, 245])
  // Concealed backs never reveal tile identity, so they are step-independent.
  expect(pixel(first, 200, 90)).toEqual([6, 95, 70])
  expect(pixel(moving, 200, 90)).toEqual([6, 95, 70])
  // New discards add faces without removing the open south hand.
  const ivory: readonly [number, number, number] = [236, 253, 245]
  expect(countColor(first, ivory)).toBeGreaterThan(2000)
  expect(countColor(moving, ivory)).toBeGreaterThan(countColor(first, ivory))
})

test("ending keeps a static ledger with a shared blink phase", () => {
  const first = renderMahjongPixels(WIDTH, HEIGHT, "mahjong-ending", 0)
  const blink = renderMahjongPixels(WIDTH, HEIGHT, "mahjong-ending", 400)
  expect(first).not.toEqual(blink)
  expect(first).toEqual(renderMahjongPixels(WIDTH, HEIGHT, "mahjong-ending", 800))
  // The marker flips with the blink phase; the ledger itself never moves.
  expect(pixel(first, 385, 430)).not.toEqual([251, 191, 36])
  expect(pixel(blink, 385, 430)).toEqual([251, 191, 36])
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
