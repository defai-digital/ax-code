import { expect, test } from "vitest"
import { hsvToRgb } from "../src/lib/rgba.js"

test("negative hues normalize into the color wheel", () => {
  expect(hsvToRgb(-60, 1, 1).toInts()).toEqual(hsvToRgb(300, 1, 1).toInts())
  expect(hsvToRgb(-60, 1, 1).toInts()).toEqual([255, 0, 255, 255])
})

test("hues past a full turn wrap to the same color", () => {
  expect(hsvToRgb(420, 1, 1).toInts()).toEqual(hsvToRgb(60, 1, 1).toInts())
  expect(hsvToRgb(360, 1, 1).toInts()).toEqual(hsvToRgb(0, 1, 1).toInts())
})
