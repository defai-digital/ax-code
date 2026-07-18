import { describe, expect, test } from "vitest"
import { formatSize } from "../../src/cli/cmd/uninstall"

describe("uninstall formatSize", () => {
  test("formats bytes, KB, MB, and GB", () => {
    expect(formatSize(512)).toBe("512 B")
    expect(formatSize(1024)).toBe("1.0 KB")
    expect(formatSize(1536)).toBe("1.5 KB")
    expect(formatSize(1024 * 1024)).toBe("1.0 MB")
    expect(formatSize(1024 * 1024 * 1024)).toBe("1.0 GB")
  })

  test("promotes to the next unit when 1-decimal rounding would hit 1024.0", () => {
    // Just under 1 MiB previously rendered as "1024.0 KB".
    expect(formatSize(1024 * 1024 - 1)).toBe("1.0 MB")
    expect(formatSize(Math.floor(999.95 * 1024) - 1)).toBe("999.9 KB")
  })
})
