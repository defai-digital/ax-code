import { describe, expect, test } from "bun:test"
import { decodePngClipboardBase64 } from "../../../src/cli/cmd/tui/util/clipboard"

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
})
