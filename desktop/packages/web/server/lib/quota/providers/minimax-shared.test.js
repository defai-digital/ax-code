import { describe, expect, it } from "vitest"
import { transformMinimaxWindows } from "./minimax-shared.js"

describe("MiniMax quota transforms", () => {
  it("treats usage counts as consumed quota for both MiniMax regions", () => {
    const windows = transformMinimaxWindows({
      current_interval_total_count: 100,
      current_interval_usage_count: 25,
      start_time: 1_000,
      end_time: 19_000,
      current_weekly_total_count: "200",
      current_weekly_usage_count: "50",
      weekly_start_time: 1_000,
      weekly_end_time: 605_800,
    })

    expect(windows["5h"]).toMatchObject({ usedPercent: 25, remainingPercent: 75, windowSeconds: 18_000 })
    expect(windows.weekly).toMatchObject({ usedPercent: 25, remainingPercent: 75, windowSeconds: 604_800 })
  })

  it("does not turn missing usage counts into 100% usage", () => {
    const windows = transformMinimaxWindows({
      current_interval_total_count: 100,
      current_interval_usage_count: null,
      current_weekly_total_count: 100,
    })

    expect(windows["5h"].usedPercent).toBeNull()
    expect(windows["5h"].remainingPercent).toBeNull()
    expect(windows.weekly.usedPercent).toBeNull()
    expect(windows.weekly.remainingPercent).toBeNull()
  })
})
