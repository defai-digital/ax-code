import { expect, test } from "vitest"
import { createRacingPixelPainter, renderRacingPixels } from "../../../src/cli/tui/component/racing-pixels"

// Maps the shared 76x24 scene to exact 10x20 pixel cells.
const WIDTH = 760
const HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]

test.each(["racing-day", "racing-night"] as const)("%s paints deterministically from elapsed time", (style) => {
  const first = renderRacingPixels(WIDTH, HEIGHT, style, 0)
  const moving = renderRacingPixels(WIDTH, HEIGHT, style, 900)
  expect(first.length).toBe(WIDTH * HEIGHT * 3)
  expect(moving.equals(renderRacingPixels(WIDTH, HEIGHT, style, 900))).toBe(true)
  expect(renderRacingPixels(WIDTH, HEIGHT, style, 2400).equals(first)).toBe(true)
  expect(renderRacingPixels(WIDTH, HEIGHT, style, -100).equals(first)).toBe(true)
  expect(moving.equals(first)).toBe(false)
  // The mountain shoulder never moves, and it is not sky.
  expect(pixel(moving, 80, 120)).toEqual(pixel(first, 80, 120))
  expect(pixel(first, 80, 120)).not.toEqual(pixel(first, 380, 0))
})

test("the GT body has visible paint and leaves road below the complete car", () => {
  for (const style of ["racing-day", "racing-night"] as const) {
    const frame = renderRacingPixels(WIDTH, HEIGHT, style, 400)
    let redBody = 0
    for (let y = 330; y < 450; y++)
      for (let x = 230; x < 520; x++) {
        const [r, g, b] = pixel(frame, x, y)
        if (r! > g! * 1.6 && r! > b! * 1.3 && r! > 55) redBody++
      }
    expect(redBody).toBeGreaterThan(1000)
    // A low car must be grounded but remain inside the frame.
    expect(pixel(frame, 370, 475)[0]!).toBeLessThan(150)
    expect(Math.max(...pixel(frame, 370, 345))).toBeLessThan(90)
  }
})

test.each(["racing-day", "racing-night"] as const)(
  "%s cache is independent of frame order and caller mutation",
  (style) => {
    const paint = createRacingPixelPainter(320, 180, style)
    paint(1500).fill(255)
    for (const ms of [900, 0, 2300, 2400, -100])
      expect(paint(ms).equals(renderRacingPixels(320, 180, style, ms))).toBe(true)
    const other = createRacingPixelPainter(160, 90, style)
    other(700)
    expect(paint(900).equals(renderRacingPixels(320, 180, style, 900))).toBe(true)
  },
)

test.each(["racing-day", "racing-night"] as const)("%s renders at any size", (style) => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [7, 7],
    [280, 900],
    [1600, 200],
  ]) {
    expect(renderRacingPixels(width!, height!, style, 700)).toHaveLength(width! * height! * 3)
  }
})

test("the racing player preserves framing and replaces its caches on style and viewport changes", async () => {
  const { inflateSync } = await import("node:zlib")
  const { digitalCodePixelPlayer, finishScenePixels } = await import(
    "../../../src/cli/tui/component/digital-code-pixels"
  )
  const { CINEMA_STILL } = await import("../../../src/cli/tui/component/scene-cinema")
  const writes: string[] = []
  const player = digitalCodePixelPlayer((data) => writes.push(data), {
    now: () => 0,
    move: { kind: "push-in", zoom: 1.1, ease: "linear", focusX: -1, focusY: -1 },
  })
  for (const [style, width, height] of [
    ["racing-day", 320, 180],
    ["racing-day", 320, 180],
    ["racing-night", 320, 180],
    ["racing-night", 400, 220],
    ["racing-day", 320, 180],
  ] as const) {
    player.draw({ width, height, columns: 80, rows: 24, direction: "down", style, elapsedMs: 1500, durationMs: 3000 })
    const payload = [...writes.at(-1)!.matchAll(/\x1b_G[^;]*;([A-Za-z0-9+/=]*)\x1b\\/g)].map((m) => m[1]).join("")
    const pixels = inflateSync(Buffer.from(payload, "base64"))
    expect(
      pixels.equals(
        finishScenePixels(renderRacingPixels(width, height, style, 1500), width, height, {
          elapsedMs: 1500,
          durationMs: 3000,
          move: CINEMA_STILL,
        }),
      ),
    ).toBe(true)
  }
  player.dispose()
  const count = writes.length
  player.dispose()
  player.draw({ width: 320, height: 180, columns: 80, rows: 24, direction: "down", style: "racing-day" })
  expect(writes).toHaveLength(count)
  expect(writes.filter((data) => data.startsWith("\x1b_Ga=d,"))).toHaveLength(4)
})
