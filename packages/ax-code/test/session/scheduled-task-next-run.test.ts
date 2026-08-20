import { describe, expect, test } from "vitest"
import { ScheduledTask } from "../../src/session/scheduled-task"

describe("ScheduledTask.nextRunAt", () => {
  test("daily local schedules advance before and after today's occurrence", () => {
    const before = new Date(2026, 7, 20, 8, 0, 0).getTime()
    expect(ScheduledTask.nextRunAt({ type: "daily", time: "09:00" }, before)).toBe(
      new Date(2026, 7, 20, 9, 0, 0).getTime(),
    )

    const after = new Date(2026, 7, 20, 10, 0, 0).getTime()
    expect(ScheduledTask.nextRunAt({ type: "daily", time: "09:00" }, after)).toBe(
      new Date(2026, 7, 21, 9, 0, 0).getTime(),
    )
  })

  test("weekly local schedules wrap and handle today's occurrence", () => {
    const thursday = new Date(2026, 7, 20, 8, 0, 0).getTime()
    expect(new Date(thursday).getDay()).toBe(4)
    expect(ScheduledTask.nextRunAt({ type: "weekly", day: 4, time: "09:00" }, thursday)).toBe(
      new Date(2026, 7, 20, 9, 0, 0).getTime(),
    )
    expect(ScheduledTask.nextRunAt({ type: "weekly", day: 1, time: "09:00" }, thursday)).toBe(
      new Date(2026, 7, 24, 9, 0, 0).getTime(),
    )

    const after = new Date(2026, 7, 20, 10, 0, 0).getTime()
    expect(ScheduledTask.nextRunAt({ type: "weekly", day: 4, time: "09:00" }, after)).toBe(
      new Date(2026, 7, 27, 9, 0, 0).getTime(),
    )
  })

  test("daily timezone schedules follow the requested wall clock across DST", () => {
    const before = Date.UTC(2026, 7, 20, 12, 0, 0) // 08:00 EDT
    expect(ScheduledTask.nextRunAt({ type: "daily", time: "09:00", timezone: "America/New_York" }, before)).toBe(
      Date.UTC(2026, 7, 20, 13, 0, 0),
    )

    const beforeFallBack = Date.UTC(2026, 9, 31, 13, 0, 0) + 1
    expect(
      ScheduledTask.nextRunAt({ type: "daily", time: "09:00", timezone: "America/New_York" }, beforeFallBack),
    ).toBe(Date.UTC(2026, 10, 1, 14, 0, 0))
  })

  test("daily timezone schedules do not repeat an ambiguous wall-clock occurrence", () => {
    // 01:30 occurs twice on the fall-back day. After the first occurrence
    // (EDT), the next daily occurrence is on the next local day, not 01:30 EST.
    const firstOccurrence = Date.UTC(2026, 10, 1, 5, 30, 0)
    expect(
      ScheduledTask.nextRunAt({ type: "daily", time: "01:30", timezone: "America/New_York" }, firstOccurrence),
    ).toBe(Date.UTC(2026, 10, 2, 6, 30, 0))
  })

  test("daily timezone schedules skip a nonexistent spring-forward wall time", () => {
    const beforeGap = Date.UTC(2026, 2, 8, 6, 0, 0) // 01:00 EST on DST transition day
    expect(ScheduledTask.nextRunAt({ type: "daily", time: "02:30", timezone: "America/New_York" }, beforeGap)).toBe(
      Date.UTC(2026, 2, 9, 6, 30, 0),
    )
  })

  test("weekly timezone schedules advance normally and across repeated wall times", () => {
    const thursday = Date.UTC(2026, 7, 20, 12, 0, 0) // Thursday 08:00 EDT
    const first = ScheduledTask.nextRunAt(
      { type: "weekly", day: 4, time: "09:00", timezone: "America/New_York" },
      thursday,
    )
    expect(first).toBe(Date.UTC(2026, 7, 20, 13, 0, 0))
    expect(
      ScheduledTask.nextRunAt({ type: "weekly", day: 4, time: "09:00", timezone: "America/New_York" }, first),
    ).toBe(Date.UTC(2026, 7, 27, 13, 0, 0))

    const repeated = Date.UTC(2026, 10, 1, 5, 30, 0) // Sunday 01:30 EDT
    expect(
      ScheduledTask.nextRunAt({ type: "weekly", day: 0, time: "01:30", timezone: "America/New_York" }, repeated),
    ).toBe(Date.UTC(2026, 10, 8, 6, 30, 0))
  })

  test("cron schedules honor local and explicit timezone fields", () => {
    const local = new Date(2026, 7, 20, 8, 0, 0).getTime()
    expect(ScheduledTask.nextRunAt({ type: "cron", expression: "15 9 * * *" }, local)).toBe(
      new Date(2026, 7, 20, 9, 15, 0).getTime(),
    )
    const monday = ScheduledTask.nextRunAt({ type: "cron", expression: "0 9 * * 1" }, local)
    expect(new Date(monday!).getDay()).toBe(1)

    const zoned = Date.UTC(2026, 7, 20, 12, 0, 0)
    expect(
      ScheduledTask.nextRunAt({ type: "cron", expression: "30 9 * * *", timezone: "America/New_York" }, zoned),
    ).toBe(Date.UTC(2026, 7, 20, 13, 30, 0))
  })

  test("one-time schedules run only when strictly in the future", () => {
    const from = Date.now()
    expect(ScheduledTask.nextRunAt({ type: "once", runAt: from + 1_000 }, from)).toBe(from + 1_000)
    expect(ScheduledTask.nextRunAt({ type: "once", runAt: from }, from)).toBeUndefined()
    expect(ScheduledTask.nextRunAt({ type: "once", runAt: from - 1_000 }, from)).toBeUndefined()
  })
})
