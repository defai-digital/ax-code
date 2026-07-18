import { describe, expect, test } from "vitest"
import { formatContextTokens } from "./ContextUsageDisplay"

describe("formatContextTokens", () => {
  test("formats small and mid-range token counts", () => {
    expect(formatContextTokens(0)).toBe("0")
    expect(formatContextTokens(12)).toBe("12")
    expect(formatContextTokens(12.5)).toBe("12.5")
    expect(formatContextTokens(1_000)).toBe("1.0K")
    expect(formatContextTokens(1_500)).toBe("1.5K")
    expect(formatContextTokens(999_949)).toBe("999.9K")
  })

  test("promotes to M when 1-decimal K rounding would yield 1000.0K", () => {
    expect(formatContextTokens(999_950)).toBe("1.0M")
    expect(formatContextTokens(999_999)).toBe("1.0M")
    expect(formatContextTokens(1_000_000)).toBe("1.0M")
    expect(formatContextTokens(2_500_000)).toBe("2.5M")
  })
})
