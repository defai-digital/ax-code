import { expect, test } from "vitest"
import { glowUnclamped, softBlob } from "../../../src/cli/tui/component/scene-art-kit"
import { createHdCanvas } from "../../../src/cli/tui/component/scene-hd"

test("unclamped light retains alpha overshoot", () => {
  const hd = createHdCanvas(1, 1, 1, 1)
  hd.pixels.fill(10)
  glowUnclamped(hd, 0.5, 0.5, 2, [100, 100, 100], 2)
  expect([...hd.pixels]).toEqual([190, 190, 190])
})

test("light respects a fractional floor without painting the following row", () => {
  const hd = createHdCanvas(1, 3, 1, 3)
  glowUnclamped(hd, 0.5, 1.5, 4, [100, 100, 100], 1, 1.5)
  expect([...hd.pixels]).toEqual([56, 56, 56, 0, 0, 0, 0, 0, 0])
})

test("soft blobs retain smoothstep power and stop at the ellipse edge", () => {
  const hd = createHdCanvas(3, 1, 3, 1)
  softBlob(hd, 0.5, 0.5, 2, 1, [100, 100, 100], 1, 2)
  expect([...hd.pixels]).toEqual([100, 100, 100, 25, 25, 25, 0, 0, 0])
})

test("soft blobs clamp alpha at the target color", () => {
  const hd = createHdCanvas(1, 1, 1, 1)
  hd.pixels.fill(10)
  softBlob(hd, 0.5, 0.5, 2, 1, [100, 100, 100], 2)
  expect([...hd.pixels]).toEqual([100, 100, 100])
})
