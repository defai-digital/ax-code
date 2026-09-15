import { describe, expect, test } from "vitest"
import { inflateSync } from "node:zlib"
import {
  createDigitalCodePixels,
  digitalCodePixelPlayer,
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
    expect(frame.width).toBe(640)
    expect(frame.height).toBe(360)
    frame.rain.columns[0]!.head = 12
    const rgb = renderDigitalCodePixels(frame)
    expect(rgb.length).toBe(640 * 360 * 3)
    expect(rgb.some((value) => value > 0)).toBe(true)
    const output = kittyDigitalCodeFrame(123, frame, 120, 40)
    const packets = [...output.matchAll(/\x1b_G([^;]+);([A-Za-z0-9+/=]*)\x1b\\/g)]
    expect(packets.length).toBeGreaterThan(0)
    expect(packets[0]![1]).toContain("a=T,f=24,o=z,s=640,v=360,i=123,p=1,c=120,r=40,C=1,z=1,q=2,")
    for (const packet of packets) expect(packet[2]!.length).toBeLessThanOrEqual(4096)
    expect(packets.at(-1)![1]).toContain("m=0")
    expect(inflateSync(Buffer.from(packets.map((packet) => packet[2]).join(""), "base64"))).toEqual(rgb)
    expect(output.startsWith("\x1b7\x1b[H")).toBe(true)
    expect(output.endsWith("\x1b8")).toBe(true)
  })

  test("deletes only its own image on resize and dispose; never draws after disposal", () => {
    const writes: string[] = []
    const player = digitalCodePixelPlayer((data) => writes.push(data))
    const input = { width: 320, height: 180, columns: 80, rows: 24, direction: "up" as const }
    player.draw(input)
    const id = /,i=(\d+),/.exec(writes[0]!)![1]
    player.draw({ ...input, width: 400, columns: 100 })
    expect(writes[1]).toBe(`\x1b_Ga=d,d=I,i=${id},q=2;\x1b\\`)
    expect(writes[2]).toContain(`i=${id},`)
    player.dispose()
    expect(writes[3]).toBe(writes[1])
    player.dispose()
    player.draw(input)
    expect(writes).toHaveLength(4)
  })

  test("unused playback emits nothing", () => {
    const writes: string[] = []
    digitalCodePixelPlayer((data) => writes.push(data)).dispose()
    expect(writes).toEqual([])
  })
})
