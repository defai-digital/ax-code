import { describe, expect, test } from "vitest"
import {
  streamPaintDecision,
  streamPaintIntervalMs,
  STREAM_PAINT_MAX_MS,
  STREAM_PAINT_MS,
} from "../../../src/cli/cmd/tui/routes/session/stream-paint"

describe("streamPaintIntervalMs", () => {
  test("short documents paint at the base interval", () => {
    expect(streamPaintIntervalMs(0)).toBe(STREAM_PAINT_MS)
    expect(streamPaintIntervalMs(1999)).toBe(STREAM_PAINT_MS)
  })

  test("the interval grows with document length", () => {
    expect(streamPaintIntervalMs(2000)).toBe(STREAM_PAINT_MS + 20)
    expect(streamPaintIntervalMs(10_000)).toBe(STREAM_PAINT_MS + 100)
  })

  test("the interval is capped for very long documents", () => {
    expect(streamPaintIntervalMs(1_000_000)).toBe(STREAM_PAINT_MAX_MS)
  })
})

describe("streamPaintDecision", () => {
  test("final updates paint immediately regardless of timing", () => {
    expect(streamPaintDecision({ final: true, now: 5, lastPaintAt: 4, length: 50_000 })).toEqual({
      action: "paint-now",
    })
  })

  test("paints immediately once the (length-scaled) interval has elapsed", () => {
    expect(streamPaintDecision({ final: false, now: 100, lastPaintAt: 0, length: 10 })).toEqual({
      action: "paint-now",
    })
  })

  test("schedules the remaining time within the interval", () => {
    expect(streamPaintDecision({ final: false, now: 30, lastPaintAt: 0, length: 10 })).toEqual({
      action: "schedule",
      delayMs: STREAM_PAINT_MS - 30,
    })
  })

  test("longer documents schedule against the scaled interval, not the base", () => {
    // 10k chars -> 40 + 5*20 = 140ms interval; 100ms elapsed -> 40ms remaining,
    // which the old fixed 40ms interval would have painted immediately.
    expect(streamPaintDecision({ final: false, now: 100, lastPaintAt: 0, length: 10_000 })).toEqual({
      action: "schedule",
      delayMs: 40,
    })
  })
})
