import { describe, expect, test } from "vitest"

import { formatDebugReplayTimestamp } from "../../src/cli/cmd/debug/replay"

describe("debug replay command", () => {
  test("formats malformed replay timestamps without throwing", () => {
    expect(formatDebugReplayTimestamp(Date.parse("2026-04-01T00:00:00Z"))).toBe("2026-04-01T00:00:00.000Z")
    expect(formatDebugReplayTimestamp(Number.NaN)).toBe("1970-01-01T00:00:00.000Z")
    expect(formatDebugReplayTimestamp(Number.POSITIVE_INFINITY)).toBe("1970-01-01T00:00:00.000Z")
    expect(formatDebugReplayTimestamp(8_640_000_000_000_001)).toBe("1970-01-01T00:00:00.000Z")
  })
})
