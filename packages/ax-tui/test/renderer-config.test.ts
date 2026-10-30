import { expect, test } from "vitest"
import { CliRenderer } from "../src/core/renderer.js"

test.each([0, -1, NaN, Infinity, Number.MIN_VALUE])(
  "frame rate setters reject unsafe timers (%s) without changing state",
  (value) => {
    const renderer = Object.create(CliRenderer.prototype) as CliRenderer
    renderer.targetFps = 30
    renderer.maxFps = 60
    expect(() => {
      renderer.targetFps = value
    }).toThrow(RangeError)
    expect(() => {
      renderer.maxFps = value
    }).toThrow(RangeError)
    expect(renderer.targetFps).toBe(30)
    expect(renderer.maxFps).toBe(60)
  },
)

test("invalid frame configuration fails before accessing streams or allocating native resources", () => {
  expect(
    () =>
      new CliRenderer(null as never, null as never, 80, 24, {
        targetFps: Infinity,
      }),
  ).toThrow(/targetFps/)
  expect(
    () =>
      new CliRenderer(null as never, null as never, 80, 24, {
        debounceDelay: Infinity,
      }),
  ).toThrow(/debounceDelay/)
})

test.each([NaN, Infinity, -1, 1.5, 65536])("unsafe renderer dimensions fail before allocation (%s)", (width) => {
  expect(() => new CliRenderer(null as never, null as never, width, 65536)).toThrow(/dimensions/)
  const renderer = Object.create(CliRenderer.prototype) as CliRenderer
  expect(() => renderer.resize(width, 65536)).toThrow(/dimensions/)
})
