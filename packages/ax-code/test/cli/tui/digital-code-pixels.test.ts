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

  test("paints classic Matrix green when falling and gold when rising", () => {
    const dominant = (direction: "down" | "up") => {
      const frame = createDigitalCodePixels(320, 180, direction, () => 0)
      frame.rain.columns[0]!.head = 12
      frame.tick = 40
      const rgb = renderDigitalCodePixels(frame)
      let r = 0
      let g = 0
      let b = 0
      for (let i = 0; i < rgb.length; i += 3) {
        r += rgb[i]!
        g += rgb[i + 1]!
        b += rgb[i + 2]!
      }
      return { r, g, b }
    }
    const green = dominant("down")
    expect(green.g).toBeGreaterThan(green.r * 1.4)
    expect(green.g).toBeGreaterThan(green.b * 1.2)
    const gold = dominant("up")
    expect(gold.r).toBeGreaterThan(gold.b * 1.5)
    expect(gold.g).toBeGreaterThan(gold.b * 1.5)
    expect(gold.r).toBeGreaterThan(gold.g)
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
        // in text, and visible ink above the empty background in pixels.
        const empty = renderDigitalCodePixels({ width: 40 * 7, height: 12 * 6, rain: { ...state, columns: [] } })
        const scaleOf = { far: 0.72, mid: 1, near: 2 } as const
        for (const column of state.columns) {
          const headRow = Math.floor(column.head)
          const scale = scaleOf[column.layer ?? "mid"]
          for (let offset = 0; offset < column.length; offset++) {
            const y = direction === "up" ? headRow + offset : headRow - offset
            if (y < 0 || y >= state.height) continue
            expect(textAt(column.x, y)).toBe(column.chars[offset] ?? " ")
            const run = runAt(column.x, y)
            expect(run.level).toBe(digitalCodeCellLevel(direction, offset, column.length))
            expect(run.hue).toBe(column.hues[offset] ?? column.hue)
            expect(run.bold).toBe(column.heavy)
          }
          // Pixel side: the lead glyph block is brighter than the empty field.
          const lead = direction === "up" ? 0 : 0
          const px = column.x * 7
          const py = Math.floor(column.head * 6) + lead
          let ink = false
          let inRange = false
          for (let yy = py; yy < py + Math.ceil(7 * scale); yy++)
            for (let xx = px; xx < px + Math.ceil(5 * scale); xx++) {
              if (xx < 0 || yy < 0 || xx >= 40 * 7 || yy >= 12 * 6) continue
              inRange = true
              const i = (yy * 40 * 7 + xx) * 3
              if (
                pixels[i]! > empty[i]! + 8 ||
                pixels[i + 1]! > empty[i + 1]! + 8 ||
                pixels[i + 2]! > empty[i + 2]! + 8
              )
                ink = true
            }
          if (inRange && direction === "down" && py >= 0 && py + 15 < 12 * 6)
            expect(ink, `missing lead ink for column ${column.x}`).toBe(true)
        }
        // The field is pure black except near a column: glow reaches at most
        // 24px sideways, so the field far from every lane stays untouched.
        for (let i = 0; i < pixels.length; i += 3) {
          if (pixels[i] === empty[i] && pixels[i + 1] === empty[i + 1] && pixels[i + 2] === empty[i + 2]) continue
          const x = (i / 3) % (40 * 7)
          expect(
            state.columns.some((column) => x >= column.x * 7 - 24 && x <= column.x * 7 + 10 + 24),
            `stray ink at pixel ${i / 3}`,
          ).toBe(true)
        }
        state = advanceDigitalCode(state)
      }
    }
  })
})

describe("Digital Code intensity layers", () => {
  const frameAt = (tick: number, direction: "down" | "up" = "down") => {
    const frame = createDigitalCodePixels(320, 180, direction, seeded(5))
    for (let i = 0; i < tick; i++) frame.rain = advanceDigitalCode(frame.rain)
    return { ...frame, tick }
  }

  test("is deterministic for the same state and tick, and animates across ticks", () => {
    expect(renderDigitalCodePixels(frameAt(30))).toEqual(renderDigitalCodePixels(frameAt(30)))
    expect(renderDigitalCodePixels(frameAt(30))).not.toEqual(renderDigitalCodePixels(frameAt(31)))
  })

  test("assigns all three depth layers with faster near drops", () => {
    const columns = createDigitalCode({ width: 160, height: 40, random: seeded(9) }).columns
    const layers = new Set(columns.map((column) => column.layer))
    expect(layers).toEqual(new Set(["far", "mid", "near"]))
    const mean = (layer: string) => {
      const list = columns.filter((column) => column.layer === layer)
      return list.reduce((total, column) => total + column.speed, 0) / list.length
    }
    expect(mean("near")).toBeGreaterThan(mean("far"))
  })

  test("bloom lifts the field well above a bare glyph pass and ignites over the opening", () => {
    const luminance = (rgb: Buffer) => rgb.reduce((total, value) => total + value, 0)
    expect(luminance(renderDigitalCodePixels(frameAt(40)))).toBeGreaterThan(
      luminance(renderDigitalCodePixels(frameAt(0))),
    )
  })

  test("columns are perfectly vertical: ink never leaves the lane band", () => {
    for (const direction of ["down", "up"] as const) {
      const rain = createDigitalCode({ width: 45, height: 30, direction, random: seeded(8) })
      const rgb = renderDigitalCodePixels({
        width: 320,
        height: 180,
        rain: { ...rain, columns: [rain.columns[10]!] },
        tick: 25,
      })
      const column = rain.columns[10]!
      const x0 = column.x * 7
      for (let i = 0; i < rgb.length; i += 3) {
        if (rgb[i] === 0 && rgb[i + 1] === 0 && rgb[i + 2] === 0) continue
        const x = (i / 3) % 320
        expect(x >= x0 - 24 && x <= x0 + 10 + 24, `ink at x=${x}`).toBe(true)
      }
      // Sharp ink (not just glow) sits strictly inside the glyph width.
      let sharpMin = 999
      let sharpMax = -1
      for (let i = 0; i < rgb.length; i += 3) {
        if (Math.max(rgb[i]!, rgb[i + 1]!, rgb[i + 2]!) < 140) continue
        const x = (i / 3) % 320
        sharpMin = Math.min(sharpMin, x)
        sharpMax = Math.max(sharpMax, x)
      }
      if (sharpMax >= 0) {
        expect(sharpMin).toBeGreaterThanOrEqual(x0)
        expect(sharpMax).toBeLessThanOrEqual(x0 + 10)
      }
    }
  })

  test("glyphs flicker and mutate over time while the column stays put", () => {
    const rain = createDigitalCode({ width: 45, height: 30, random: seeded(8) })
    rain.columns = [{ ...rain.columns[10]!, head: 14 }]
    const frames = Array.from({ length: 12 }, (_, tick) =>
      renderDigitalCodePixels({ width: 320, height: 180, rain, tick: 20 + tick }),
    )
    expect(new Set(frames.map((frame) => frame.toString("base64"))).size).toBeGreaterThan(6)
  })

  test("the background is pure black away from the rain", () => {
    const rgb = renderDigitalCodePixels({
      width: 320,
      height: 180,
      rain: { ...frameAt(0).rain, columns: [] },
      tick: 50,
    })
    expect(rgb.every((value) => value === 0)).toBe(true)
  })

  test.each([
    [0, 0],
    [1, 1],
    [7, 7],
    [2000, 20],
    [20, 900],
  ])("renders %ix%i without throwing", (w, h) => {
    const frame = createDigitalCodePixels(w, h, "up", seeded(2))
    frame.tick = 45
    expect(renderDigitalCodePixels(frame)).toHaveLength(frame.width * frame.height * 3)
  })
})
