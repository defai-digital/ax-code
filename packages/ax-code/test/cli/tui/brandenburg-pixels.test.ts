import { expect, test } from "vitest"
import { renderBrandenburgPixels } from "../../../src/cli/tui/component/brandenburg-pixels"
import { renderTextScenePixels } from "../../../src/cli/tui/component/text-scene-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["brandenburg-night", "brandenburg-dawn"] as const)(
  "%s paints deterministically from elapsed time",
  (style) => {
    const night = style === "brandenburg-night"
    const first = renderBrandenburgPixels(WIDTH, HEIGHT, style, 0)
    const moving = renderBrandenburgPixels(WIDTH, HEIGHT, style, 900)
    expect(first.length).toBe(WIDTH * HEIGHT * 3)
    expect(moving.equals(renderBrandenburgPixels(WIDTH, HEIGHT, style, 900))).toBe(true)
    expect(renderBrandenburgPixels(WIDTH, HEIGHT, style, 900).equals(moving)).toBe(true)
    expect(renderBrandenburgPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
    // A plaza lamp post never moves.
    const post: readonly [number, number, number] = night ? [44, 44, 58] : [110, 100, 80]
    expect(pixel(first, 105, 350)).toEqual(post)
    expect(pixel(moving, 105, 350)).toEqual(post)
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
