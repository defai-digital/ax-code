import { describe, expect, it } from "vitest"
import {
  normalizeScheduledTaskTime,
  normalizeScheduledTaskTimes,
  parseScheduledTaskTimeParts,
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
})
