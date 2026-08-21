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

  test("cron supports day-of-month and month fields", () => {
    // 09:00 on the 1st of every month
    const from = new Date(2026, 7, 20, 8, 0, 0).getTime() // Aug 20
    const first = ScheduledTask.nextRunAt({ type: "cron", expression: "0 9 1 * *" }, from)
    expect(first).toBe(new Date(2026, 8, 1, 9, 0, 0).getTime()) // Sep 1
    // the following occurrence is the next month
    expect(ScheduledTask.nextRunAt({ type: "cron", expression: "0 9 1 * *" }, first!)).toBe(
      new Date(2026, 9, 1, 9, 0, 0).getTime(),
    )
  })

  test("cron month field restricts firing to the named month", () => {
    const from = new Date(2026, 0, 15, 0, 0, 0).getTime() // Jan 15
    // 00:00 on day 1 of March only
    const next = ScheduledTask.nextRunAt({ type: "cron", expression: "0 0 1 3 *" }, from)
    expect(next).toBe(new Date(2026, 2, 1, 0, 0, 0).getTime()) // Mar 1
  })

  test("cron applies POSIX OR when both dom and dow are restricted", () => {
    // 09:00 on the 1st OR on Mondays
    const from = new Date(2026, 7, 20, 8, 0, 0).getTime() // Thu Aug 20
    const next = ScheduledTask.nextRunAt({ type: "cron", expression: "0 9 1 * 1" }, from)
    // Next Monday is Aug 24, which comes before Sep 1 — OR semantics pick it.
    expect(next).toBe(new Date(2026, 7, 24, 9, 0, 0).getTime())
    expect(new Date(next!).getDay()).toBe(1)
  })

  test("cron treats a restricted dom with wildcard dow as AND (dom only)", () => {
    // 09:00 on the 15th (dow is *)
    const from = new Date(2026, 7, 20, 8, 0, 0).getTime() // Aug 20
    const next = ScheduledTask.nextRunAt({ type: "cron", expression: "0 9 15 * *" }, from)
    expect(next).toBe(new Date(2026, 8, 15, 9, 0, 0).getTime()) // Sep 15
    expect(new Date(next!).getDate()).toBe(15)
  })

  test("cron accepts 7 as Sunday alias for 0", () => {
    const from = new Date(2026, 7, 20, 8, 0, 0).getTime() // Thursday
    const bySeven = ScheduledTask.nextRunAt({ type: "cron", expression: "0 9 * * 7" }, from)
    const byZero = ScheduledTask.nextRunAt({ type: "cron", expression: "0 9 * * 0" }, from)
    expect(bySeven).toBe(byZero)
    expect(new Date(bySeven!).getDay()).toBe(0)
  })

  test("validateSchedule rejects impossible cron expressions", () => {
    // February 31 never exists
    expect(() => ScheduledTask.validateSchedule({ type: "cron", expression: "0 0 31 2 *" })).toThrow(
      ScheduledTask.InvalidSchedule,
    )
    // structurally invalid
    expect(() => ScheduledTask.validateSchedule({ type: "cron", expression: "not a cron" })).toThrow(
      ScheduledTask.InvalidSchedule,
    )
    // a valid, realizable expression passes
    expect(() => ScheduledTask.validateSchedule({ type: "cron", expression: "0 9 1 * *" })).not.toThrow()
  })

  test("jitter is deterministic per id and never applied to one-time tasks", () => {
    const schedule: ScheduledTask.Schedule = { type: "daily", time: "09:00" }
    const a = ScheduledTask.jitterOffsetMs({ id: "sch_test_a" as never, schedule })
    const b = ScheduledTask.jitterOffsetMs({ id: "sch_test_a" as never, schedule })
    const c = ScheduledTask.jitterOffsetMs({ id: "sch_test_c" as never, schedule })
    expect(a).toBe(b) // stable across calls
    expect(a).toBeGreaterThanOrEqual(0)
    expect(c).toBeGreaterThanOrEqual(0)
    // one-time schedules are never jittered
    expect(ScheduledTask.jitterOffsetMs({ id: "sch_test_a" as never, schedule: { type: "once", runAt: 1 } })).toBe(0)
  })

  test("countCoalesced counts missed occurrences up to now", () => {
    const schedule: ScheduledTask.Schedule = { type: "cron", expression: "0 * * * *" } // hourly
    const first = new Date(2026, 7, 20, 0, 0, 0).getTime()
    // 8 hourly occurrences later
    const now = new Date(2026, 7, 20, 8, 30, 0).getTime()
    const { count, lastOccurrence } = ScheduledTask.countCoalesced(schedule, first, now)
    expect(count).toBe(9) // 00:00 .. 08:00 inclusive
    expect(lastOccurrence).toBe(new Date(2026, 7, 20, 8, 0, 0).getTime())
  })

  test("countCoalesced returns 1 when nothing was missed", () => {
    const schedule: ScheduledTask.Schedule = { type: "cron", expression: "0 * * * *" }
    const first = new Date(2026, 7, 20, 0, 0, 0).getTime()
    const now = new Date(2026, 7, 20, 0, 10, 0).getTime()
    const { count, lastOccurrence } = ScheduledTask.countCoalesced(schedule, first, now)
    expect(count).toBe(1)
    expect(lastOccurrence).toBe(first)
  })
})
