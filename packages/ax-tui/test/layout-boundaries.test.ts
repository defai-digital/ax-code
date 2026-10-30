import { describe, expect, test } from "vitest"
import {
  isDimensionType,
  isMarginType,
  isPaddingType,
  isValidPercentage,
  validateOptions,
} from "../src/lib/renderable.validations.js"
import { getObjectsInViewport } from "../src/lib/objects-in-viewport.js"

describe("layout input boundaries", () => {
  test.each([NaN, Infinity, -Infinity])("rejects non-finite geometry %s", (value) => {
    expect(() => validateOptions("test", { width: value })).toThrow(/width/)
    expect(() => validateOptions("test", { height: value })).toThrow(/height/)
    expect(isDimensionType(value)).toBe(false)
    expect(isMarginType(value)).toBe(false)
    expect(isPaddingType(value)).toBe(false)
  })

  test.each(["10garbage%", "Infinity%", "1e999%", "%", "0x10%", "10 %"])("rejects malformed percentage %s", (value) => {
    expect(isValidPercentage(value)).toBe(false)
  })

  test("accepts dot-without-fraction and exponent percentages, fails fast on near-misses", () => {
    expect(isValidPercentage("5.%")).toBe(true)
    expect(isValidPercentage("5.e2%")).toBe(true)
    expect(isValidPercentage(".5%")).toBe(true)
    expect(isValidPercentage(`${"9".repeat(10_000)}%`)).toBe(false) // numeric value overflows to Infinity
    // This shape used to trigger quadratic backtracking in the validator.
    expect(isValidPercentage(`${"9".repeat(10_000)}x%`)).toBe(false)
  })

  test("retains fractional sizing and negative margins but rejects negative dimensions", () => {
    expect(isDimensionType(1.5)).toBe(true)
    expect(isDimensionType(-1)).toBe(false)
    expect(isDimensionType("-10%")).toBe(false)
    expect(isMarginType(-1)).toBe(true)
    expect(isMarginType("-10%")).toBe(true)
    expect(isPaddingType(-1)).toBe(false)
    expect(isValidPercentage("1.25%")).toBe(true)
  })
})

describe("viewport culling", () => {
  test.each(["column", "row"] as const)("retains long overlapping objects in %s layouts", (direction) => {
    const objects = Array.from({ length: 200 }, (_, i) => ({
      id: i,
      screenX: direction === "row" ? i : 0,
      screenY: direction === "column" ? i : 0,
      width: direction === "row" && i === 0 ? 200 : 1,
      height: direction === "column" && i === 0 ? 200 : 1,
      zIndex: i === 0 ? 1 : 0,
    }))
    const viewport = {
      x: direction === "row" ? 150 : 0,
      y: direction === "column" ? 150 : 0,
      width: 1,
      height: 1,
    }
    expect(getObjectsInViewport(viewport, objects, direction, 0).map((item) => item.id)).toEqual([150, 0])
  })

  test("filters and orders small collections with the same overlap rules", () => {
    const objects = [
      { screenX: 0, screenY: 0, width: 10, height: 10, zIndex: 2 },
      { screenX: 0, screenY: 1, width: 10, height: 1, zIndex: 1 },
      { screenX: 20, screenY: 2, width: 10, height: 1, zIndex: 0 },
    ]
    expect(getObjectsInViewport({ x: 0, y: 1, width: 10, height: 2 }, objects, "column", 0)).toEqual([
      objects[1],
      objects[0],
    ])
  })
})

test("viewport culling matches a full rectangle scan for varied overlapping layouts", () => {
  let seed = 123456789
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  for (const direction of ["row", "column"] as const) {
    for (let trial = 0; trial < 100; trial++) {
      const objects = Array.from({ length: 100 }, () => ({
        screenX: Math.floor(random() * 1000),
        screenY: Math.floor(random() * 1000),
        width: 1 + Math.floor(random() * 1000),
        height: 1 + Math.floor(random() * 1000),
        zIndex: Math.floor(random() * 5),
      })).sort((a, b) => (direction === "row" ? a.screenX - b.screenX : a.screenY - b.screenY))
      const viewport = { x: Math.floor(random() * 1000), y: Math.floor(random() * 1000), width: 80, height: 24 }
      const expected = objects
        .filter(
          (item) =>
            item.screenX < viewport.x + viewport.width &&
            item.screenX + item.width > viewport.x &&
            item.screenY < viewport.y + viewport.height &&
            item.screenY + item.height > viewport.y,
        )
        .sort((a, b) => a.zIndex - b.zIndex)
      expect(getObjectsInViewport(viewport, objects, direction, 0)).toEqual(expected)
    }
  }
})
