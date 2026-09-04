import { describe, expect, test } from "vitest"
import {
  decodePngClipboardBase64,
  isWslRelease,
  osc52ClipboardSequence,
  osc52MuxFromEnv,
  OSC52_MAX_BYTES,
  SCREEN_PASSTHROUGH_CHUNK_SIZE,
} from "../../../src/cli/cmd/tui/util/clipboard"
import { wrapOscForMux } from "../../../src/cli/cmd/tui/util/osc-passthrough"

describe("TUI clipboard helpers", () => {
  test("decodes valid PNG base64 from clipboard image probes", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    expect(decodePngClipboardBase64(png.toString("base64"))?.equals(png)).toBe(true)
  })

  test("rejects non-base64 clipboard image probe output", () => {
    expect(decodePngClipboardBase64("GetImage failed: not an image")).toBeUndefined()
  })

  test("rejects base64 output that is not a PNG", () => {
    expect(decodePngClipboardBase64(Buffer.from("not a png").toString("base64"))).toBeUndefined()
  })

  test("detects WSL2 kernel release strings", () => {
    expect(isWslRelease("5.15.153.1-microsoft-standard-WSL2")).toBe(true)
  })

  test("detects WSL1 kernel release strings", () => {
    // WSL1 releases contain "Microsoft" but no "WSL" marker.
    expect(isWslRelease("4.4.0-22621-Microsoft")).toBe(true)
  })

  test("does not flag plain Linux kernel release strings as WSL", () => {
    expect(isWslRelease("6.8.0-51-generic")).toBe(false)
  })
})

describe("OSC 52 mux and sequence", () => {
  test("prefers tmux over GNU Screen when both env vars are set", () => {
    expect(osc52MuxFromEnv({ TMUX: "/tmp/tmux-1000/default,1,0", STY: "12345.pts-0.host" })).toBe("tmux")
    expect(osc52MuxFromEnv({ STY: "12345.pts-0.host" })).toBe("screen")
    expect(osc52MuxFromEnv({})).toBe("none")
  })

  test("emits a BEL-terminated OSC 52 for a direct TTY", () => {
    expect(osc52ClipboardSequence("hi", "none")).toBe(`\x1b]52;c;${Buffer.from("hi").toString("base64")}\x07`)
  })

  test("wraps tmux passthrough by doubling ESC, keeping BEL", () => {
    const inner = `\x1b]52;c;${Buffer.from("hi").toString("base64")}\x07`
    expect(osc52ClipboardSequence("hi", "tmux")).toBe(`\x1bPtmux;${inner.replaceAll("\x1b", "\x1b\x1b")}\x1b\\`)
  })

  test("does not wrap GNU Screen with tmux DCS", () => {
    const sequence = osc52ClipboardSequence("hi", "screen")
    expect(sequence).not.toContain("tmux;")
    expect(sequence).toBe(`\x1bP\x1b]52;c;${Buffer.from("hi").toString("base64")}\x07\x1b\\`)
  })

  test("chunks Screen payloads at 252 bytes and uses BEL not inner ST", () => {
    // 183 ASCII bytes of payload → 244 base64 chars + 8-byte BEL framing = 252
    // (one Screen DCS chunk). 184 bytes of payload crosses into a second chunk.
    const oneChunk = osc52ClipboardSequence("A".repeat(183), "screen")
    const twoChunks = osc52ClipboardSequence("A".repeat(184), "screen")
    expect(oneChunk).not.toBeUndefined()
    expect(twoChunks).not.toBeUndefined()
    expect(oneChunk!.startsWith("\x1bP")).toBe(true)
    expect(oneChunk!.endsWith("\x07\x1b\\")).toBe(true)
    expect(oneChunk!.split("\x1bP")).toHaveLength(2) // leading empty + one envelope
    expect(twoChunks!.split("\x1bP")).toHaveLength(3)
    expect(twoChunks!.includes("\x1b\\")).toBe(true)
    // Inner OSC must not use ST: Screen would consume it as the DCS end.
    const inner = twoChunks!.replaceAll("\x1bP", "").replaceAll("\x1b\\", "")
    expect(inner.startsWith("\x1b]52;c;")).toBe(true)
    expect(inner.endsWith("\x07")).toBe(true)
    expect(inner.includes("\x1b\\")).toBe(false)
    expect(SCREEN_PASSTHROUGH_CHUNK_SIZE).toBe(252)
  })

  test("rejects payloads over the OSC 52 byte cap", () => {
    expect(osc52ClipboardSequence("x".repeat(OSC52_MAX_BYTES + 1), "none")).toBeUndefined()
  })

  test.each([
    { label: "two-byte code points", body: String.fromCodePoint(0xe9).repeat(130) },
    { label: "three-byte code points", body: String.fromCodePoint(0x4e2d).repeat(100) },
    { label: "a surrogate pair at the chunk boundary", body: "x".repeat(247) + String.fromCodePoint(0x1f680) },
  ])("preserves $label within Screen byte limits", ({ body }) => {
    const sequence = `\x1b]9;${body}\x07`
    const wire = Buffer.from(wrapOscForMux(sequence, "screen")).toString("utf8")
    const chunks = [...wire.matchAll(/\x1bP([\s\S]*?)\x1b\\/g)].map((match) => match[1])

    expect(chunks.join("")).toBe(sequence)
    for (const chunk of chunks) {
      expect(Buffer.byteLength(chunk)).toBeLessThanOrEqual(SCREEN_PASSTHROUGH_CHUNK_SIZE)
      expect(chunk.isWellFormed()).toBe(true)
    }
  })

  test("wrapOscForMux is the shared tmux/Screen envelope", () => {
    expect(wrapOscForMux("\x1b]9;hi\x07", "none")).toBe("\x1b]9;hi\x07")
    expect(wrapOscForMux("\x1b]9;hi\x07", "tmux")).toBe("\x1bPtmux;\x1b\x1b]9;hi\x07\x1b\\")
    expect(wrapOscForMux("\x1b]9;hi\x07", "screen")).toBe("\x1bP\x1b]9;hi\x07\x1b\\")
  })
})
