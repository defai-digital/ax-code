import { describe, expect, test } from "vitest"
import { inflateSync } from "node:zlib"
import {
  advanceDigitalCode,
  createDigitalCode,
  DIGITAL_CODE_LEVEL_RGB,
  digitalCodeCellLevel,
  digitalCodeRows,
} from "../../../src/cli/tui/component/digital-code-view-model"
import {
  createDigitalCodePixels,
  DIGITAL_CODE_PIXEL_MAX_HEIGHT,
  DIGITAL_CODE_PIXEL_MAX_WIDTH,
  digitalCodePixelPlayer,
  kittyDigitalCodeDeleteSequence,
  kittyDigitalCodeFrame,
  renderDigitalCodePixels,
  supportsDigitalCodePixels,
} from "../../../src/cli/tui/component/digital-code-pixels"

const supported = {
  tty: true,
  screenMode: "alternate-screen",
  capabilities: { kitty_graphics: true, remote: false, multiplexer: "none" },
}

describe("Digital Code pixel admission", () => {
  test("requires confirmed graphics, a local TTY, and the alternate screen", () => {
    expect(supportsDigitalCodePixels(supported)).toBe(true)
    for (const override of [
      { tty: false },
      { screenMode: "main-screen" },
      { capabilities: null },
      { capabilities: { ...supported.capabilities, kitty_graphics: false } },
      { capabilities: { ...supported.capabilities, remote: true } },
      { capabilities: { ...supported.capabilities, multiplexer: "tmux" } },
    ]) {
      expect(supportsDigitalCodePixels({ ...supported, ...override })).toBe(false)
    }
  })
})

describe("Digital Code pixel transport", () => {
  test("bounds raster size and transmits lossless compressed RGB in bounded chunks", () => {
    const frame = createDigitalCodePixels(3840, 2160, "down")
    expect(frame.width).toBe(DIGITAL_CODE_PIXEL_MAX_WIDTH)
    expect(frame.height).toBe(DIGITAL_CODE_PIXEL_MAX_HEIGHT)
    frame.rain.columns[0]!.head = 12
    const rgb = renderDigitalCodePixels(frame)
    expect(rgb.length).toBe(DIGITAL_CODE_PIXEL_MAX_WIDTH * DIGITAL_CODE_PIXEL_MAX_HEIGHT * 3)
    expect(rgb.some((value) => value > 0)).toBe(true)
    const output = kittyDigitalCodeFrame(123, frame, 120, 40)
    const packets = [...output.matchAll(/\x1b_G([^;]+);([A-Za-z0-9+/=]*)\x1b\\/g)]
    expect(packets.length).toBeGreaterThan(0)
    expect(packets[0]![1]).toContain(
      `a=T,f=24,o=z,s=${DIGITAL_CODE_PIXEL_MAX_WIDTH},v=${DIGITAL_CODE_PIXEL_MAX_HEIGHT},i=123,p=1,c=120,r=40,C=1,z=1,q=2,`,
    )
    for (const packet of packets) expect(packet[2]!.length).toBeLessThanOrEqual(4096)
    expect(packets.at(-1)![1]).toContain("m=0")
    expect(inflateSync(Buffer.from(packets.map((packet) => packet[2]).join(""), "base64"))).toEqual(rgb)
    expect(output.startsWith("\x1b7\x1b[H")).toBe(true)
    expect(output.endsWith("\x1b8")).toBe(true)
  })

  test("paints Digital Code purple and blue ramps instead of a single magenta", () => {
    const frame = createDigitalCodePixels(320, 180, "down", () => 0)
    frame.rain.columns[0]!.head = 8
    frame.rain.columns[0]!.hue = "purple"
    frame.rain.columns[0]!.hues = frame.rain.columns[0]!.hues.map(() => "purple")
    if (frame.rain.columns[1]) {
      frame.rain.columns[1].head = 8
      frame.rain.columns[1].hue = "blue"
      frame.rain.columns[1].hues = frame.rain.columns[1].hues.map(() => "blue")
    }
    const rgb = renderDigitalCodePixels(frame)
    const near = (pixel: readonly [number, number, number], ramp: readonly (readonly [number, number, number])[]) =>
      ramp.some(
        ([r, g, b]) =>
          (r > 0 || g > 0 || b > 0) &&
          Math.abs(pixel[0] - r) <= 48 &&
          Math.abs(pixel[1] - g) <= 48 &&
          Math.abs(pixel[2] - b) <= 48,
      )
    let sawPurple = false
    let sawBlue = false
    for (let i = 0; i < rgb.length; i += 3) {
      const pixel = [rgb[i]!, rgb[i + 1]!, rgb[i + 2]!] as const
      if (pixel[0] === 0 && pixel[1] === 0 && pixel[2] === 0) continue
      if (near(pixel, DIGITAL_CODE_LEVEL_RGB.purple)) sawPurple = true
      if (near(pixel, DIGITAL_CODE_LEVEL_RGB.blue)) sawBlue = true
    }
    expect(sawPurple).toBe(true)
    expect(sawBlue).toBe(true)
  })

  test("deletes only its own image on resize and dispose; never draws after disposal", () => {
    const writes: string[] = []
    const player = digitalCodePixelPlayer((data) => writes.push(data))
    const input = { width: 320, height: 180, columns: 80, rows: 24, direction: "up" as const }
    player.draw(input)
    const id = /,i=(\d+),/.exec(writes[0]!)![1]
    player.draw({ ...input, width: 400, columns: 100 })
    expect(writes[1]).toBe(kittyDigitalCodeDeleteSequence(Number(id)))
    expect(writes[2]).toContain(`i=${id},`)
    player.dispose()
    expect(writes[3]).toBe(writes[1])
    player.dispose()
    player.draw(input)
    expect(writes).toHaveLength(4)
  })

  test("renders a frame when a rain cell is blank instead of crashing", () => {
    const frame = createDigitalCodePixels(320, 180, "down", () => 0)
    frame.rain.columns[0]!.head = 8
    frame.rain.columns[0]!.chars[0] = ""
    expect(() => renderDigitalCodePixels(frame)).not.toThrow()
    expect(renderDigitalCodePixels(frame)).toHaveLength(320 * 180 * 3)
  })

  test("recreates the rain when only the direction changes on an unchanged size", () => {
    const writes: string[] = []
    const player = digitalCodePixelPlayer((data) => writes.push(data))
    const input = { width: 320, height: 180, columns: 80, rows: 24, direction: "down" as const }
    player.draw(input)
    expect(writes).toHaveLength(1)
    player.draw({ ...input, direction: "up" })
    expect(writes).toHaveLength(3)
    const id = /,i=(\d+),/.exec(writes[0]!)![1]
    expect(writes[1]).toBe(kittyDigitalCodeDeleteSequence(Number(id)))
    expect(writes[2]).toContain("a=T,")
    expect(writes[2]).toContain("i=" + id + ",")
  })

  test("unused playback emits nothing", () => {
    const writes: string[] = []
    digitalCodePixelPlayer((data) => writes.push(data)).dispose()
    expect(writes).toEqual([])
  })
})

function seeded(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe("Digital Code text/pixel agreement", () => {
  // Cell literals below intentionally mirror DIGITAL_CODE_PIXEL_CELL_WIDTH /
  // HEIGHT instead of importing them, so the mapping cannot drift silently.
  test.each(["down", "up"] as const)("%s rain paints the same drops in text and pixels", (direction) => {
    for (const seed of [3, 17, 42]) {
      let state = createDigitalCode({ width: 40, height: 12, direction, random: seeded(seed) })
      for (let tick = 0; tick <= 5; tick++) {
        const rows = digitalCodeRows(state)
        const pixels = renderDigitalCodePixels({ width: 40 * 7, height: 12 * 6, rain: state })
        const textAt = (x: number, y: number) => rows[y]!.map((run) => run.text).join("")[x]
        const runAt = (x: number, y: number) => {
          let column = 0
          for (const run of rows[y]!) {
            if (x < column + run.text.length) return run
            column += run.text.length
          }
          throw new Error(`no run covers ${x},${y}`)
        }
        // Every in-screen trail cell shows its glyph, level, hue, and weight
        // in text, and ink in the matching pixel block.
        for (const column of state.columns) {
          const headRow = Math.floor(column.head)
          for (let offset = 0; offset < column.length; offset++) {
            const y = direction === "up" ? headRow + offset : headRow - offset
            if (y < 0 || y >= state.height) continue
            expect(textAt(column.x, y)).toBe(column.chars[offset] ?? " ")
            const run = runAt(column.x, y)
            expect(run.level).toBe(digitalCodeCellLevel(direction, offset, column.length))
            expect(run.hue).toBe(column.hues[offset] ?? column.hue)
            expect(run.bold).toBe(column.heavy)
            const px = column.x * 7
            const py = Math.floor(column.head * 6) + (direction === "up" ? offset * 6 : -offset * 6)
            let inRange = false
            let ink = false
            for (let yy = py + 1; yy <= py + 5; yy++) {
              for (let xx = px; xx < px + 5; xx++) {
                if (xx < 0 || yy < 0 || xx >= 40 * 7 || yy >= 12 * 6) continue
                inRange = true
                const i = (yy * 40 * 7 + xx) * 3
                if (pixels[i] !== 0 || pixels[i + 1] !== 0 || pixels[i + 2] !== 0) ink = true
              }
            }
            if (inRange) expect(ink, `missing ink for ${column.x},${y} offset ${offset}`).toBe(true)
          }
        }
        // No ink anywhere except a glyph block or its one-pixel glow margin.
        const allowed = new Set<number>()
        for (const column of state.columns) {
          for (let offset = 0; offset < column.length; offset++) {
            const py = Math.floor(column.head * 6) + (direction === "up" ? offset * 6 : -offset * 6)
            if (py < -7 || py >= 12 * 6) continue
            for (let yy = py - 1; yy <= py + 7; yy++)
              for (let xx = column.x * 7 - 1; xx <= column.x * 7 + 5; xx++)
                if (xx >= 0 && yy >= 0 && xx < 40 * 7 && yy < 12 * 6) allowed.add(yy * 40 * 7 + xx)
          }
        }
        for (let i = 0; i < pixels.length; i += 3) {
          if (pixels[i] === 0 && pixels[i + 1] === 0 && pixels[i + 2] === 0) continue
          expect(allowed.has(i / 3), `stray ink at pixel ${i / 3}`).toBe(true)
        }
        state = advanceDigitalCode(state)
      }
    }
  })
})
