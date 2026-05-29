import { describe, expect, test } from "bun:test"
import { runCommandCenterPerformanceSmoke } from "../src/performance/smoke"

describe("command-center performance smoke", () => {
  test("keeps high-frequency event replay and long-session rendering inside local beta budgets", () => {
    const result = runCommandCenterPerformanceSmoke({
      messageEvents: 1_500,
      queueEvents: 1_200,
      scheduledEvents: 120,
      viewModelEvery: 75,
      maxDurationMs: 5_000,
      maxHeapDeltaBytes: 128 * 1024 * 1024,
    })

    expect(result.appliedEvents).toBe(4_320)
    expect(result.visibleMessages).toBeGreaterThan(0)
    expect(result.visibleMessages).toBeLessThanOrEqual(200)
    expect(result.hiddenMessages).toBeGreaterThanOrEqual(0)
    expect(result.visibleQueueItems).toBe(200)
    expect(result.hiddenQueueItems).toBeGreaterThan(1_000)
    expect(result.scheduledTasks).toBeGreaterThanOrEqual(120)
    expect(result.withinBudget).toBe(true)
  })
})
