import { describe, expect, test } from "vitest"
import { relativeTimeParts } from "./ScheduledTasksDialog"

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const NOW = 1_700_000_000_000

describe("relativeTimeParts", () => {
  test("returns empty for missing or non-finite values", () => {
    expect(relativeTimeParts(undefined, NOW)).toEqual({ kind: "empty" })
    expect(relativeTimeParts(Number.NaN, NOW)).toEqual({ kind: "empty" })
    expect(relativeTimeParts(0, NOW)).toEqual({ kind: "empty" })
  })

  test("uses second-scale labels under one minute", () => {
    expect(relativeTimeParts(NOW + 30_000, NOW)).toEqual({ kind: "seconds", future: true })
    expect(relativeTimeParts(NOW - 30_000, NOW)).toEqual({ kind: "seconds", future: false })
  })

  test("formats whole minutes under one hour", () => {
    expect(relativeTimeParts(NOW + 5 * MINUTE, NOW)).toEqual({
      kind: "minutes",
      future: true,
      count: 5,
    })
    expect(relativeTimeParts(NOW - 59 * MINUTE, NOW)).toEqual({
      kind: "minutes",
      future: false,
      count: 59,
    })
  })

  test("promotes to 1h when rounded minutes would be 60", () => {
    // 59.5 minutes previously rendered as "60 minutes".
    expect(relativeTimeParts(NOW + 59.5 * MINUTE, NOW)).toEqual({
      kind: "duration",
      future: true,
      body: "1h",
    })
    expect(relativeTimeParts(NOW + 3_570_000, NOW).body).toBe("1h")
  })

  test("never emits 60m remainder after an hour", () => {
    // floor(hours) + round(remainder minutes) previously yielded "1h 60m".
    expect(relativeTimeParts(NOW + 7_170_000, NOW)).toEqual({
      kind: "duration",
      future: true,
      body: "2h",
    })
    expect(relativeTimeParts(NOW + 7_199_999, NOW).body).toBe("2h")
    expect(relativeTimeParts(NOW + 2 * HOUR, NOW).body).toBe("2h")
    expect(relativeTimeParts(NOW + HOUR + 30 * MINUTE, NOW).body).toBe("1h 30m")
  })

  test("never emits 24h remainder after a day", () => {
    // floor(days) + round(remainder hours) previously yielded "1d 24h".
    expect(relativeTimeParts(NOW + 171_000_000, NOW)).toEqual({
      kind: "duration",
      future: true,
      body: "2d",
    })
    expect(relativeTimeParts(NOW + 172_799_999, NOW).body).toBe("2d")
    expect(relativeTimeParts(NOW + 2 * DAY, NOW).body).toBe("2d")
    expect(relativeTimeParts(NOW + DAY + 5 * HOUR, NOW).body).toBe("1d 5h")
  })

  test("marks past timestamps as not future", () => {
    expect(relativeTimeParts(NOW - HOUR - 30 * MINUTE, NOW)).toEqual({
      kind: "duration",
      future: false,
      body: "1h 30m",
    })
  })
})
