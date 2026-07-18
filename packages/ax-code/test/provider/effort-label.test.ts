import { describe, expect, test } from "vitest"
import {
  clampEffort,
  effortChangeMessage,
  effortDescription,
  effortDisplay,
  effortLabel,
  effortOptions,
} from "../../src/provider/effort-label"

describe("effort-label", () => {
  test("maps common provider keys to friendly labels", () => {
    expect(effortLabel(undefined)).toBe("Auto")
    expect(effortLabel("")).toBe("Auto")
    expect(effortLabel("low")).toBe("Fast")
    expect(effortLabel("medium")).toBe("Balanced")
    expect(effortLabel("high")).toBe("Deep")
    expect(effortLabel("xhigh")).toBe("Max")
    expect(effortLabel("max")).toBe("Max")
    expect(effortLabel("custom-tier")).toBe("Custom-tier")
  })

  test("display uses the friendly label", () => {
    expect(effortDisplay(undefined)).toBe("Auto")
    expect(effortDisplay("high")).toBe("Deep")
  })

  test("change message includes wire key when it differs from the label", () => {
    expect(effortChangeMessage(undefined)).toBe("Effort → Auto (balanced, may raise)")
    expect(effortChangeMessage("high")).toBe("Effort → Deep (high)")
    expect(effortChangeMessage("thinking")).toBe("Effort → Thinking")
  })

  test("builds picker options with Auto first and no duplicates", () => {
    const options = effortOptions(["high", "max", "high", ""])
    expect(options.map((o) => o.value)).toEqual([undefined, "high", "max"])
    expect(options[0]?.label).toBe("Auto")
    expect(options[1]?.label).toBe("Deep")
    expect(options[1]?.detail).toBe("high")
    expect(options[2]?.label).toBe("Max")
    // detail is omitted when the wire key is just a casing of the label
    expect(options[2]?.detail).toBeUndefined()
  })

  test("descriptions cover known and unknown keys", () => {
    expect(effortDescription(undefined)).toMatch(/balanced/i)
    expect(effortDescription("low")).toMatch(/simple/i)
    expect(effortDescription("weird")).toContain("weird")
  })

  test("clampEffort drops keys the model no longer exposes", () => {
    expect(clampEffort("high", ["low", "high", "max"])).toBe("high")
    expect(clampEffort("xhigh", ["low", "high", "max"])).toBeUndefined()
    expect(clampEffort(undefined, ["high"])).toBeUndefined()
  })
})
