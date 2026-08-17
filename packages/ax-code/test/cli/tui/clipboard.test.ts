import { describe, expect, test } from "vitest"
import { decodePngClipboardBase64, isWslRelease } from "../../../src/cli/cmd/tui/util/clipboard"

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
