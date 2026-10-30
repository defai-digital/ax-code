import { randomBytes } from "node:crypto"
import { inflateSync } from "node:zlib"
import { expect, test } from "vitest"
import { encodeKittyImage, kittyPlaceholder, supportsKittyPlaceholders, MAX_KITTY_CELLS } from "../src/lib/kitty-image.js"
import { createTerminalCapabilities } from "../src/testing/terminal-capabilities.js"

test("Kitty RGBA uploads use bounded base64 chunks, exact dimensions and a virtual placement", () => {
  const image = { width: 128, height: 128, data: randomBytes(128 * 128 * 4) }
  const sequence = new TextDecoder().decode(encodeKittyImage(image, 0x12345678, 40, 20))
  const packets = [...sequence.matchAll(/\x1b_G([^;\x1b]*)(?:;([^\x1b]*))?\x1b\\/g)]
  expect(packets.length).toBeGreaterThan(3)
  expect(packets[0]![1]).toBe("a=t,f=32,o=z,t=d,s=128,v=128,i=305419896,q=2,m=1")
  const upload = packets.slice(0, -1)
  for (const packet of upload) expect(packet[2]!.length).toBeLessThanOrEqual(4096)
  expect(upload.at(-1)![1]).toContain("m=0")
  expect(inflateSync(Buffer.from(upload.map((packet) => packet[2]).join(""), "base64"))).toEqual(image.data)
  expect(packets.at(-1)![1]).toBe("a=p,U=1,i=305419896,c=40,r=20,q=2")
  expect(sequence).not.toMatch(/\x1b\[/)
})

test("every Kitty cell encodes explicit coordinates and the high image ID byte", () => {
  expect(kittyPlaceholder(42, 0, 1)).toBe("\u{10eeee}\u0305\u030d\u0305")
  expect(kittyPlaceholder(0x0200002a, 1, 0)).toBe("\u{10eeee}\u030d\u0305\u030e")
  expect(() => kittyPlaceholder(0, 0, 0)).toThrow()
  expect(() => kittyPlaceholder(42, -1, 0)).toThrow()
  expect(() => kittyPlaceholder(42, MAX_KITTY_CELLS, 0)).toThrow()
  expect(() => encodeKittyImage({ width: 1, height: 1, data: new Uint8Array(4) }, 42, 0, 1)).toThrow()
})

test("automatic Kitty placeholders require a confirmed extension version, RGB and direct transport", () => {
  const caps = createTerminalCapabilities({ kitty_graphics: true, rgb: true,
    terminal: { name: "kitty", version: "0.28.0", from_xtversion: true } })
  expect(supportsKittyPlaceholders(caps)).toBe(true)
  expect(supportsKittyPlaceholders({ ...caps, terminal: { ...caps.terminal, version: "0.27.1" } })).toBe(false)
  expect(supportsKittyPlaceholders({ ...caps, terminal: { ...caps.terminal, name: "other" } })).toBe(false)
  expect(supportsKittyPlaceholders({ ...caps, terminal: { ...caps.terminal, name: "other" } }, true)).toBe(true)
  expect(supportsKittyPlaceholders({ ...caps, rgb: false }, true)).toBe(false)
  expect(supportsKittyPlaceholders({ ...caps, multiplexer: "tmux" }, true)).toBe(false)
  expect(supportsKittyPlaceholders(null, true)).toBe(false)
})
