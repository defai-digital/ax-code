import { describe, expect, test } from "vitest"
import {
  assertImagePixelCoordinate,
  imageBudgetOk,
  newComputerFrameID,
  wrapUntrustedObservation,
} from "../../../src/visual/computer/frame"
import { COMPUTER_IMAGE_MAX_LONG_EDGE, type ComputerFrame } from "../../../src/visual/computer/protocol"

const frame: ComputerFrame = {
  frameID: "f1",
  app: { appID: "com.apple.TextEdit", displayName: "TextEdit", pid: 1 },
  window: {
    windowID: "w1",
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    scaleFactor: 2,
  },
  image: { width: 800, height: 600, mime: "image/png" },
  elements: [],
  capturedAt: 1,
}

describe("computer frame helpers", () => {
  test("frame IDs are opaque random strings, not counters", () => {
    const a = newComputerFrameID()
    const b = newComputerFrameID()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[0-9a-f-]{36}$/i)
  })

  test("coordinates are returned-image pixels", () => {
    expect(() => assertImagePixelCoordinate(frame, 799, 599)).not.toThrow()
    expect(() => assertImagePixelCoordinate(frame, 800, 0)).toThrow(/outside/)
    expect(() => assertImagePixelCoordinate(frame, -1, 0)).toThrow(/non-negative/)
  })

  test("image budget rejects oversized frames", () => {
    expect(imageBudgetOk({ width: 1280, height: 720, bytes: 100 })).toBe(true)
    expect(imageBudgetOk({ width: COMPUTER_IMAGE_MAX_LONG_EDGE + 1, height: 10, bytes: 10 })).toBe(false)
    expect(imageBudgetOk({ width: 10, height: 10, bytes: 900_001 })).toBe(false)
  })

  test("observations are wrapped as untrusted", () => {
    expect(wrapUntrustedObservation("hello")).toContain('trust="untrusted"')
    expect(wrapUntrustedObservation("hello")).toContain("hello")
  })
})
