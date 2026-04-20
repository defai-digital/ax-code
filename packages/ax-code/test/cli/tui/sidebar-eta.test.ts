import { describe, expect, test } from "bun:test"
import { estimateContextEta, formatContextEtaLabel } from "../../../src/cli/cmd/tui/routes/session/sidebar-eta"

describe("sidebar context ETA", () => {
  test("bases rate on tokens consumed during the current busy run", () => {
    const now = 1_000_000
    const result = estimateContextEta({
      now,
      limit: 100_000,
      totalTokens: 52_000,
      run: {
        startedAt: now - 600_000,
        startTokens: 40_000,
      },
      prevSample: {
        time: now - 5_000,
        tokens: 51_900,
      },
    })

    expect(result.estimate?.remainSec).toBe(2400)
  })

  test("does not clamp long estimates to one hour", () => {
    const now = 2_000_000
    const result = estimateContextEta({
      now,
      limit: 1_000_000,
      totalTokens: 1_200,
      run: {
        startedAt: now - 10_000,
        startTokens: 0,
      },
      prevSample: {
        time: now - 5_000,
        tokens: 600,
      },
    })

    expect(result.estimate?.remainSec).toBeGreaterThan(3600)
  })

  test("waits for enough run data before showing an estimate", () => {
    const now = 3_000_000
    const result = estimateContextEta({
      now,
      limit: 128_000,
      totalTokens: 250,
      run: {
        startedAt: now - 20_000,
        startTokens: 0,
      },
    })

    expect(result.estimate).toBeUndefined()
  })

  test("formats the label as context-fill time", () => {
    expect(formatContextEtaLabel(3900)).toBe("context full in ~1h 5m")
    expect(formatContextEtaLabel(125)).toBe("context full in ~2m 5s")
  })
})
