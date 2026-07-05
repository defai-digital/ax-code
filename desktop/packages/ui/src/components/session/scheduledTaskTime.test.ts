import { describe, expect, it } from "vitest"
import { normalizeScheduledTaskTimes } from "./scheduledTaskTime"

describe("normalizeScheduledTaskTimes", () => {
  it("keeps valid HH:mm values sorted and deduplicated", () => {
    expect(normalizeScheduledTaskTimes(["18:00", "09:30", "18:00", "00:05"])).toEqual(["00:05", "09:30", "18:00"])
  })

  it("ignores invalid and non-string values", () => {
    expect(normalizeScheduledTaskTimes(["09:00", "24:00", "9:00", "09:60", null, 930])).toEqual(["09:00"])
  })

  it("preserves strict matching behavior for padded strings", () => {
    expect(normalizeScheduledTaskTimes([" 09:00 ", "09:00"])).toEqual(["09:00"])
  })
})
