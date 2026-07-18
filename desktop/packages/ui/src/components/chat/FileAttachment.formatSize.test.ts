import { describe, expect, test } from "vitest"
import { formatAttachedFileSize } from "./fileAttachmentFormat"

describe("formatAttachedFileSize", () => {
  test("formats bytes, KB, and MB", () => {
    expect(formatAttachedFileSize(undefined)).toBe("")
    expect(formatAttachedFileSize(0)).toBe("")
    expect(formatAttachedFileSize(512)).toBe("512 B")
    expect(formatAttachedFileSize(1024)).toBe("1.0 KB")
    expect(formatAttachedFileSize(1536)).toBe("1.5 KB")
    expect(formatAttachedFileSize(1024 * 1024)).toBe("1.0 MB")
  })

  test("promotes to the next unit when 1-decimal rounding would hit 1024.0", () => {
    // Just under 1 MiB used to render as "1024.0 KB".
    expect(formatAttachedFileSize(1024 * 1024 - 1)).toBe("1.0 MB")
    // Values below the binary-unit boundary must not promote prematurely.
    expect(formatAttachedFileSize(1000 * 1024)).toBe("1000.0 KB")
    expect(formatAttachedFileSize(Math.ceil(1023.95 * 1024) - 1)).toBe("1023.9 KB")

    expect(formatAttachedFileSize(1024 * 1024 * 1024 - 1)).toBe("1.0 GB")
    expect(formatAttachedFileSize(1000 * 1024 * 1024)).toBe("1000.0 MB")
  })
})
