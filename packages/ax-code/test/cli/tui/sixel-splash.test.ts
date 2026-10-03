import { describe, expect, test } from "vitest"
import {
  SIXEL_SPLASH_MAX_BYTES,
  SIXEL_SPLASH_MAX_HEIGHT,
  SIXEL_SPLASH_MAX_WIDTH,
  encodeSixelSplash,
  padSplashToBand,
  sixelSplashPlayer,
  sixelSplashSize,
  supportsSixelSplash,
} from "../../../src/cli/tui/component/sixel-splash"

const supported = {
  tty: true,
  screenMode: "alternate-screen",
  columns: 120,
  rows: 40,
  capabilities: { kitty_graphics: false, sixel: true, remote: false, multiplexer: "none" },
  windowsTerminal: true,
  env: undefined as boolean | undefined,
}

describe("Sixel splash admission", () => {
  test("requires sixel without kitty, a local TTY, and the alternate screen", () => {
    expect(supportsSixelSplash(supported)).toBe(true)
    for (const override of [
      { tty: false },
      { screenMode: "main-screen" },
      { columns: 30 },
      { rows: 8 },
      { capabilities: null },
      { capabilities: { ...supported.capabilities, sixel: false } },
      { capabilities: { ...supported.capabilities, kitty_graphics: true } },
      { capabilities: { ...supported.capabilities, remote: true } },
      { capabilities: { ...supported.capabilities, multiplexer: "tmux" } },
      { windowsTerminal: false },
      { env: false },
    ]) {
      expect(supportsSixelSplash({ ...supported, ...override })).toBe(false)
    }
  })

  test("env override bypasses the host gate for testing", () => {
    expect(supportsSixelSplash({ ...supported, windowsTerminal: false, env: true })).toBe(true)
  })
})

describe("Sixel splash sizing", () => {
  test("fits resolutions into the budget preserving aspect", () => {
    expect(sixelSplashSize(1920, 1080)).toEqual({ width: 640, height: 360 })
    expect(sixelSplashSize(800, 100)).toEqual({ width: 640, height: 80 })
    expect(sixelSplashSize(100, 40)).toEqual({ width: 100, height: 40 })
    expect(sixelSplashSize(0, 0)).toEqual({ width: 1, height: 1 })
    expect(SIXEL_SPLASH_MAX_WIDTH).toBe(640)
    expect(SIXEL_SPLASH_MAX_HEIGHT).toBe(360)
    expect(SIXEL_SPLASH_MAX_BYTES).toBe(256 * 1024)
  })

  test("pads raster height to a band multiple with the background", () => {
    const rgb = Buffer.alloc(4 * 4 * 3, 255)
    const padded = padSplashToBand(rgb, 4, 4, "#010203")
    expect(padded?.width).toBe(4)
    expect(padded?.height).toBe(6)
    expect(padded?.data.subarray(0, 48)).toEqual(rgb)
    expect(padded?.data.subarray(48)).toEqual(Buffer.concat(Array.from({ length: 8 }, () => Buffer.from([1, 2, 3]))))
    const band = Buffer.alloc(4 * 6 * 3, 7)
    const aligned = padSplashToBand(band, 4, 6, "#000000")
    expect(aligned?.height).toBe(6)
    expect(aligned?.data).toEqual(band)
    expect(padSplashToBand(rgb, 4, 4, "bogus")).not.toBeNull()
    expect(padSplashToBand(rgb, 0, 4, "#000000")).toBeNull()
    expect(padSplashToBand(rgb.subarray(1), 4, 4, "#000000")).toBeNull()
  })
})

describe("Sixel splash encoding", () => {
  test("emits one 7-bit DCS frame with an exact palette", () => {
    const red = Buffer.alloc(6 * 6 * 3)
    for (let offset = 0; offset < red.length; offset += 3) red[offset] = 255
    expect(encodeSixelSplash(red, 6, 6)).toBe('\x1bP0;1;0q"1;1;6;6#1;2;100;0;0#1!6~$\x1b\\')
  })

  test("orders registers by first appearance with per-color passes", () => {
    const split = Buffer.alloc(12 * 6 * 3)
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 12; x++) {
        const offset = (y * 12 + x) * 3
        if (x < 6) split[offset] = 255
        else split[offset + 2] = 255
      }
    }
    const output = encodeSixelSplash(split, 12, 6)
    expect(output).toContain("#1;2;100;0;0#2;2;0;0;100")
    expect(output).toContain("#1!6~!6?$#2!6?!6~$")
  })

  test("caps RLE runs at 255", () => {
    const wide = Buffer.alloc(300 * 6 * 3)
    const output = encodeSixelSplash(wide, 300, 6)
    expect(output).toContain("!255")
    expect(output).toContain("!45")
  })

  test("quantizes gradients deterministically under the byte budget", () => {
    const gradient = Buffer.alloc(320 * 180 * 3)
    for (let y = 0; y < 180; y++) {
      for (let x = 0; x < 320; x++) {
        const value = Math.round((x / 319) * 255)
        const offset = (y * 320 + x) * 3
        gradient[offset] = value
        gradient[offset + 1] = value
        gradient[offset + 2] = value
      }
    }
    const first = encodeSixelSplash(gradient, 320, 180)
    expect(first).not.toBeNull()
    expect(first!.length).toBeLessThan(SIXEL_SPLASH_MAX_BYTES)
    expect(encodeSixelSplash(gradient, 320, 180)).toBe(first)
    for (const char of first!) expect(char.charCodeAt(0)).toBeLessThan(128)
  })

  test("rejects noisy rasters that exceed the byte budget", () => {
    let seed = 0x12345678
    const random = () => {
      seed = (Math.imul(seed ^ (seed >>> 15), seed | 1) + 0x6d2b79f5) | 0
      return (seed >>> 0) / 4294967296
    }
    const noise = Buffer.alloc(640 * 360 * 3)
    for (let offset = 0; offset < noise.length; offset++) noise[offset] = Math.floor(random() * 256)
    expect(encodeSixelSplash(noise, 640, 360)).toBeNull()
  })

  test("rejects invalid rasters", () => {
    expect(encodeSixelSplash(Buffer.alloc(4 * 5 * 3), 4, 5)).toBeNull()
    expect(encodeSixelSplash(Buffer.alloc(10), 2, 6)).toBeNull()
    expect(encodeSixelSplash(Buffer.alloc(0), 0, 6)).toBeNull()
  })
})

describe("Sixel splash player", () => {
  test("draws once and repaints the background on dispose", () => {
    const writes: string[] = []
    const player = sixelSplashPlayer((data) => writes.push(data))
    player.draw({ width: 96, height: 72, direction: "down", background: "#000000" })
    player.draw({ width: 96, height: 72, direction: "down", background: "#000000" })
    expect(writes).toHaveLength(1)
    expect(writes[0]!.startsWith("\x1b7\x1b[H\x1bP")).toBe(true)
    expect(writes[0]!.endsWith("\x1b\\\x1b8")).toBe(true)
    player.dispose()
    expect(writes).toHaveLength(2)
    expect(writes[1]).toContain('"1;1;96;72')
    expect(writes[1]).toContain("#1;2;0;0;0")
  })

  test("renders scene styles at the fitted geometry", () => {
    const writes: string[] = []
    const player = sixelSplashPlayer((data) => writes.push(data))
    player.draw({ width: 96, height: 72, direction: "down", style: "midnight-dream", background: "#0b132b" })
    expect(writes).toHaveLength(1)
    expect(writes[0]).toContain('"1;1;96;72')
  })

  test("dispose without draw writes nothing and tolerates bad backgrounds", () => {
    const writes: string[] = []
    sixelSplashPlayer((data) => writes.push(data)).dispose()
    expect(writes).toHaveLength(0)
    const fallback: string[] = []
    const player = sixelSplashPlayer((data) => fallback.push(data))
    player.draw({ width: 48, height: 36, direction: "up", background: "bogus" })
    expect(fallback).toHaveLength(1)
    player.dispose()
    expect(fallback).toHaveLength(2)
  })
})

describe("Sixel raster admission", () => {
  test("rejects fractional and over-budget geometry before encoding", () => {
    expect(encodeSixelSplash(Buffer.alloc(9), 0.5, 6)).toBeNull()
    expect(encodeSixelSplash(Buffer.alloc(641 * 6 * 3), 641, 6)).toBeNull()
    expect(encodeSixelSplash(Buffer.alloc(6 * 366 * 3), 6, 366)).toBeNull()
    expect(padSplashToBand(Buffer.alloc(9), 0.5, 6, "#000000")).toBeNull()
  })

  test("non-finite resolutions fit to safe geometry", () => {
    expect(sixelSplashSize(Number.NaN, 72)).toEqual({ width: 1, height: 72 })
    expect(sixelSplashSize(96, Infinity)).toEqual({ width: 96, height: 1 })
  })
})
