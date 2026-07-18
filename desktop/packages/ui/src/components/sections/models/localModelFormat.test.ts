import { describe, expect, test } from "vitest"
import { formatLocalModelBytes } from "./localModelFormat"

describe("formatLocalModelBytes", () => {
  test("formats binary sizes and invalid values", () => {
    expect(formatLocalModelBytes()).toBe("Unknown")
    expect(formatLocalModelBytes(Number.NaN)).toBe("Unknown")
    expect(formatLocalModelBytes(Number.POSITIVE_INFINITY)).toBe("Unknown")
    expect(formatLocalModelBytes(0)).toBe("0 B")
    expect(formatLocalModelBytes(512)).toBe("512 B")
    expect(formatLocalModelBytes(1536)).toBe("1.5 KiB")
  })

  test("promotes rounded 1024-unit values", () => {
    expect(formatLocalModelBytes(1000 * 1024)).toBe("1000 KiB")
    expect(formatLocalModelBytes(1024 * 1024 - 1)).toBe("1.0 MiB")
    expect(formatLocalModelBytes(1024 * 1024 * 1024 - 1)).toBe("1.0 GiB")
  })
})
