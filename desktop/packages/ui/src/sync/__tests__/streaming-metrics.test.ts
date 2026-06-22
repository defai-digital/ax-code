import { describe, expect, test, beforeEach } from "vitest"
import { createMetricsTracker, type MetricsTracker } from "../streaming-metrics"

describe("createMetricsTracker", () => {
  let tracker: MetricsTracker

  beforeEach(() => {
    tracker = createMetricsTracker()
  })

  describe("initial state", () => {
    test("returns default metrics for unknown sessions", () => {
      const metrics = tracker.getMetrics("nonexistent")
      expect(metrics.phase).toBe("idle")
      expect(metrics.prefillMs).toBeNull()
      expect(metrics.decodeTps).toBe(0)
      expect(metrics.tokenCount).toBe(0)
      expect(metrics.totalBytes).toBe(0)
      expect(metrics.startedAt).toBeNull()
      expect(metrics.lastDeltaAt).toBeNull()
    })
  })

  describe("prefill phase", () => {
    test("enters prefill phase on session busy", () => {
      tracker.onSessionBusy("session-1")
      const metrics = tracker.getMetrics("session-1")
      expect(metrics.phase).toBe("prefill")
      expect(metrics.prefillMs).toBeNull()
      expect(metrics.startedAt).toBeGreaterThan(0)
    })

    test("transitions to decoding on first delta", () => {
      tracker.onSessionBusy("session-1")
      tracker.onDelta("session-1", 5)
      const metrics = tracker.getMetrics("session-1")
      expect(metrics.phase).toBe("decoding")
      expect(metrics.prefillMs! >= 0).toBe(true)
      expect(metrics.tokenCount).toBe(1)
      expect(metrics.totalBytes).toBe(5)
    })
  })

  describe("decode rate", () => {
    test("returns 0 decode rate with fewer than MIN_SAMPLES", () => {
      tracker.onSessionBusy("session-1")
      tracker.onDelta("session-1", 1)
      tracker.onDelta("session-1", 1)
      const metrics = tracker.getMetrics("session-1")
      expect(metrics.decodeTps).toBe(0)
    })

    test("computes decode rate after enough samples", async () => {
      tracker.onSessionBusy("session-1")
      // Simulate 10 deltas arriving over ~50ms (enough for rate calc)
      for (let i = 0; i < 10; i++) {
        tracker.onDelta("session-1", 3)
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      const metrics = tracker.getMetrics("session-1")
      // Rate should be > 0 since we have 10 samples spread over ~50ms
      expect(metrics.decodeTps).toBeGreaterThan(0)
      expect(metrics.tokenCount).toBe(10)
      expect(metrics.totalBytes).toBe(30)
    })
  })

  describe("idle phase", () => {
    test("transitions to idle on session idle", () => {
      tracker.onSessionBusy("session-1")
      tracker.onDelta("session-1", 1)
      tracker.onSessionIdle("session-1")
      const metrics = tracker.getMetrics("session-1")
      expect(metrics.phase).toBe("idle")
      expect(metrics.decodeTps).toBe(0)
      expect(metrics.tokenCount).toBe(1)
    })
  })

  describe("multi-session isolation", () => {
    test("tracks sessions independently", () => {
      tracker.onSessionBusy("session-a")
      tracker.onSessionBusy("session-b")
      tracker.onDelta("session-a", 10)
      tracker.onDelta("session-a", 10)
      tracker.onDelta("session-b", 5)

      const metricsA = tracker.getMetrics("session-a")
      const metricsB = tracker.getMetrics("session-b")

      expect(metricsA.tokenCount).toBe(2)
      expect(metricsA.totalBytes).toBe(20)
      expect(metricsB.tokenCount).toBe(1)
      expect(metricsB.totalBytes).toBe(5)
    })

    test("resets state on new busy for same session", () => {
      tracker.onSessionBusy("session-1")
      tracker.onDelta("session-1", 10)
      tracker.onDelta("session-1", 10)
      tracker.onSessionIdle("session-1")

      // New turn starts fresh
      tracker.onSessionBusy("session-1")
      const metrics = tracker.getMetrics("session-1")
      expect(metrics.phase).toBe("prefill")
      expect(metrics.tokenCount).toBe(0)
      expect(metrics.totalBytes).toBe(0)
    })
  })

  describe("getAllMetrics", () => {
    test("returns all tracked sessions", () => {
      tracker.onSessionBusy("session-a")
      tracker.onSessionBusy("session-b")
      tracker.onDelta("session-a", 1)

      const all = tracker.getAllMetrics()
      expect(all.size).toBe(2)
      expect(all.get("session-a")?.tokenCount).toBe(1)
      expect(all.get("session-b")?.tokenCount).toBe(0)
    })
  })

  describe("removeSession", () => {
    test("removes tracking state", () => {
      tracker.onSessionBusy("session-1")
      tracker.onDelta("session-1", 1)
      tracker.removeSession("session-1")
      const metrics = tracker.getMetrics("session-1")
      expect(metrics.phase).toBe("idle")
      expect(metrics.tokenCount).toBe(0)
    })
  })

  describe("delta without prior busy", () => {
    test("creates state retroactively", () => {
      tracker.onDelta("orphan-session", 3)
      const metrics = tracker.getMetrics("orphan-session")
      expect(metrics.phase).toBe("decoding")
      expect(metrics.tokenCount).toBe(1)
      expect(metrics.totalBytes).toBe(3)
    })
  })
})
