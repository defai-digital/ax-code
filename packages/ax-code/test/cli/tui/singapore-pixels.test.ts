import { inflateSync } from "node:zlib"
import { expect, test } from "vitest"
import { renderSingaporePixels } from "../../../src/cli/tui/component/singapore-pixels"
import { SINGAPORE_COLORS } from "../../../src/cli/tui/component/singapore-view-model"
import { renderTextScenePixels } from "../../../src/cli/tui/component/text-scene-pixels"
import {
  digitalCodePixelPlayer,
  kittyDigitalCodeDeleteSequence,
} from "../../../src/cli/tui/component/digital-code-pixels"

const WIDTH = 760,
  HEIGHT = 480
const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3)]
const rgb = (hex: string) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16))

test.each(["singapore-day", "singapore-night"] as const)(
  "%s paints deterministic frames with recognizable landmarks",
  (style) => {
    const first = renderSingaporePixels(WIDTH, HEIGHT, style, 0),
      moving = renderSingaporePixels(WIDTH, HEIGHT, style, 1000)
    const colors = SINGAPORE_COLORS[style]
    expect(first).toHaveLength(WIDTH * HEIGHT * 3)
    expect(first.equals(moving)).toBe(false)
    expect(renderSingaporePixels(WIDTH, HEIGHT, style, 1000).equals(moving)).toBe(true)
    expect(renderSingaporePixels(WIDTH, HEIGHT, style, -1).equals(first)).toBe(true)
    expect(renderTextScenePixels(WIDTH, HEIGHT, style, 1000).equals(moving)).toBe(true)
    // Foreground fish body, tower facade/shaded side, and green roof stay anchored.
    expect(pixel(first, 143, 290)).toEqual(rgb(colors.stone))
    expect(pixel(first, 343, 175)).not.toEqual(pixel(first, 369, 175))
    expect(pixel(first, 310, 127)).toEqual(rgb(colors.green))
    expect(pixel(first, 143, 290)).toEqual(pixel(moving, 143, 290))
    // Boat moves, leaving a freshly painted water surface behind it.
    expect(pixel(first, 465, 425)).not.toEqual(pixel(moving, 465, 425))
  },
)

test.each(["singapore-day", "singapore-night"] as const)(
  "%s renders empty, tiny, fractional and extreme viewports",
  (style) => {
    for (const [width, height] of [
      [0, 0],
      [0, 5],
      [5, 0],
      [1, 1],
      [7, 7],
      [280, 900],
      [1600, 200],
      [76.9, 24.9],
    ])
      expect(renderSingaporePixels(width!, height!, style, 1000)).toHaveLength(
        Math.floor(width!) * Math.floor(height!) * 3,
      )
  },
)

test("existing Kitty player routes both Singapore variants, resizes and cleans up", () => {
  const writes: string[] = []
  const player = digitalCodePixelPlayer((data) => writes.push(data))
  const input = {
    width: 304,
    height: 192,
    columns: 76,
    rows: 24,
    direction: "down" as const,
    style: "singapore-day" as const,
    elapsedMs: 1000,
  }
  const decode = (output: string) => {
    const chunks = [...output.matchAll(/\x1b_G([^;]+);([A-Za-z0-9+/=]*)\x1b\\/g)]
    expect(chunks.length).toBeGreaterThan(0)
    return inflateSync(Buffer.from(chunks.map((chunk) => chunk[2]).join(""), "base64"))
  }
  player.draw(input)
  const id = Number(/,i=(\d+),/.exec(writes[0]!)![1])
  expect(decode(writes[0]!).equals(renderSingaporePixels(304, 192, "singapore-day", 1000))).toBe(true)
  player.draw({ ...input, direction: "up", style: "singapore-night" })
  expect(writes[1]).toBe(kittyDigitalCodeDeleteSequence(id))
  expect(decode(writes[2]!).equals(renderSingaporePixels(304, 192, "singapore-night", 1000))).toBe(true)
  player.draw({ ...input, width: 380, columns: 95 })
  expect(writes[3]).toBe(kittyDigitalCodeDeleteSequence(id))
  expect(writes[4]).toContain("s=380,v=192,")
  expect(decode(writes[4]!).equals(renderSingaporePixels(380, 192, "singapore-day", 1000))).toBe(true)
  player.dispose()
  expect(writes[5]).toBe(kittyDigitalCodeDeleteSequence(id))
  player.dispose()
  player.draw(input)
  expect(writes).toHaveLength(6)
})
