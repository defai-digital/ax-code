import { describe, expect, it } from "vitest"
import {
  normalizeScheduledTaskTime,
  normalizeScheduledTaskTimes,
  parseScheduledTaskTimeParts,
  resolveScheduledTaskTimes,
} from "./time.js"

describe("scheduled task time helpers", () => {
  it("normalizes HH:mm values", () => {
    expect(normalizeScheduledTaskTime(" 09:30 ")).toBe("09:30")
    expect(normalizeScheduledTaskTime("24:00")).toBeNull()
    expect(normalizeScheduledTaskTime("9:30")).toBeNull()
    expect(normalizeScheduledTaskTime(null)).toBeNull()
  })

  it("deduplicates and sorts normalized times", () => {
    expect(normalizeScheduledTaskTimes(["18:00", "09:30", "18:00", " 00:05 ", "09:60"])).toEqual([
      "00:05",
      "09:30",
      "18:00",
    ])
  })

  it("parses normalized time parts", () => {
    expect(parseScheduledTaskTimeParts(" 07:05 ")).toEqual({ hour: 7, minute: 5 })
    expect(parseScheduledTaskTimeParts("07:99")).toBeNull()
  })

  it("resolves schedule times from list, legacy single time, and existing fallback", () => {
    expect(resolveScheduledTaskTimes({ times: ["18:00", "09:30", "18:00"], time: "09:30" })).toEqual(["09:30", "18:00"])
    expect(resolveScheduledTaskTimes({ time: "07:45" })).toEqual(["07:45"])
    expect(resolveScheduledTaskTimes({}, { existingSchedule: { times: ["22:00"] } })).toEqual(["22:00"])
  })

  it("can reject invalid schedule.times entries", () => {
    expect(resolveScheduledTaskTimes({ times: ["09:00", "bad"] })).toEqual(["09:00"])
    expect(() => resolveScheduledTaskTimes({ times: ["09:00", "bad"] }, { rejectInvalidTimes: true })).toThrow(
      "schedule.times must contain HH:mm values",
    )
  })
})
