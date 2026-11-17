import { expect, test } from "vitest"
import { createFastGlow, glow } from "../../../src/cli/tui/component/atmos-paint"
import { createHdCanvas } from "../../../src/cli/tui/component/scene-hd"

test("the quantized glow keeps a blend at the half-channel rounding boundary", () => {
  const hd = createHdCanvas(1, 1, 1, 1)
  createFastGlow(hd)(0.5, 0.5, 1, [255, 255, 255], 1 / 510)
  expect([...hd.pixels]).toEqual([1, 1, 1])
})

test("quantized glow matches the reference painter across clipping, strength, and flattening", () => {
  for (const strength of [0, 1 / 510, 0.01, 0.5, 1, 2]) {
    for (const radius of [0.25, 1, 3.5]) {
      for (const squash of [0.5, 1, 2]) {
        for (const cx of [-0.5, 1.5, 7.25]) {
          const expected = createHdCanvas(9, 7, 9, 7)
          const actual = createHdCanvas(9, 7, 9, 7)
          for (let i = 0; i < expected.pixels.length; i++) {
            expected.pixels[i] = actual.pixels[i] = (i * 17) % 256
          }
          glow(expected, cx, 1.5, radius, [255, 100, 0], strength, squash)
          createFastGlow(actual)(cx, 1.5, radius, [255, 100, 0], strength, squash)
          expect(actual.pixels.equals(expected.pixels), JSON.stringify({ strength, radius, squash, cx })).toBe(true)
        }
      }
    }
  }
})
