import { expect, test } from "vitest"
import { LinearScrollAccel, MacOSScrollAccel } from "../src/lib/scroll-acceleration.js"

test("macOS acceleration engages for a fast burst that starts at clock zero", () => {
  const accel = new MacOSScrollAccel()

  expect(accel.tick(0)).toBe(1)
  expect(accel.tick(10)).toBe(6)
  expect(accel.tick(20)).toBe(6)
})

test("macOS acceleration resets the streak after a pause or an explicit reset", () => {
  const accel = new MacOSScrollAccel()

  accel.tick(0)
  accel.tick(10)
  expect(accel.tick(200)).toBe(1)
  expect(accel.tick(210)).toBe(6)

  accel.reset()
  expect(accel.tick(0)).toBe(1)
  expect(accel.tick(10)).toBe(6)
})

test("macOS acceleration ignores sub-interval ticks without resetting the streak", () => {
  const accel = new MacOSScrollAccel()

  expect(accel.tick(0)).toBe(1)
  expect(accel.tick(3)).toBe(1)
  expect(accel.tick(13)).toBeGreaterThan(1)
})

test("linear acceleration never accelerates", () => {
  const accel = new LinearScrollAccel()

  expect(accel.tick(0)).toBe(1)
  expect(accel.tick(10)).toBe(1)
  accel.reset()
  expect(accel.tick(20)).toBe(1)
})
