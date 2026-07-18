import { describe, expect, test } from "vitest"
import { formatDuration } from "./memoryDebugFormat"

describe("MemoryDebugPanel formatDuration", () => {
  test("formats sub-second durations in ms", () => {
    expect(formatDuration(0)).toBe("0ms")
    expect(formatDuration(500)).toBe("500ms")
    expect(formatDuration(999)).toBe("999ms")
    expect(formatDuration(999.49)).toBe("999ms")
    expect(formatDuration(999.5)).toBe("1.0s")
  })

  test("formats sub-minute durations with one decimal second", () => {
    expect(formatDuration(1_000)).toBe("1.0s")
    expect(formatDuration(1_500)).toBe("1.5s")
    expect(formatDuration(30_000)).toBe("30.0s")
  })

  test("formats multi-minute durations without a 60s remainder", () => {
    expect(formatDuration(60_000)).toBe("1m 0s")
    expect(formatDuration(65_000)).toBe("1m 5s")
    // Regression: floor(minutes) + round(remainder) previously emitted "1m 60s".
    expect(formatDuration(119_500)).toBe("2m 0s")
    expect(formatDuration(119_999)).toBe("2m 0s")
    expect(formatDuration(120_000)).toBe("2m 0s")
    expect(formatDuration(179_500)).toBe("3m 0s")
    expect(formatDuration(3_599_500)).toBe("60m 0s")
  })
})
