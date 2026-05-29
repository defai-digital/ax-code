import { describe, expect, test } from "bun:test"
import { runCommandCenterBetaQaSmoke } from "../src/performance/beta-qa"

describe("command-center beta QA smoke", () => {
  test("covers long-session rendering and transient reconnect recovery", async () => {
    const result = await runCommandCenterBetaQaSmoke({
      longSession: {
        messageEvents: 1_500,
        queueEvents: 1_200,
        scheduledEvents: 120,
        viewModelEvery: 75,
        maxDurationMs: 5_000,
        maxHeapDeltaBytes: 128 * 1024 * 1024,
      },
    })

    expect(result.longSession.withinBudget).toBe(true)
    expect(result.longSession.visibleMessages).toBeLessThanOrEqual(200)
    expect(result.longSession.visibleQueueItems).toBe(200)
    expect(result.reconnect).toMatchObject({
      attempts: 2,
      appliedCount: 2,
      reconnectedSessionPresent: true,
      reconnectedQueuePresent: true,
      withinBudget: true,
    })
    expect(result.reconnect.statuses).toEqual(["connecting", "error", "connecting", "connected", "connected"])
    expect(result.withinBudget).toBe(true)
  })
})
