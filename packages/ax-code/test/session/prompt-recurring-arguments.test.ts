import { describe, expect, test } from "vitest"
import {
  MAX_LOOP_INTERVAL_MS,
  MIN_LOOP_INTERVAL_MS,
  formatLoopInterval,
  parseLoopInterval,
  parseRecurringArguments,
} from "../../src/session/prompt-recurring-arguments"

describe("parseRecurringArguments", () => {
  test("empty and status render the status view", () => {
    expect(parseRecurringArguments("")).toEqual({ action: "status" })
    expect(parseRecurringArguments("   ")).toEqual({ action: "status" })
    expect(parseRecurringArguments("status")).toEqual({ action: "status" })
    expect(parseRecurringArguments("STATUS")).toEqual({ action: "status" })
  })

  test("stop is recognized case-insensitively", () => {
    expect(parseRecurringArguments("stop")).toEqual({ action: "stop" })
    expect(parseRecurringArguments("Stop")).toEqual({ action: "stop" })
  })

  test("starts a loop with each interval unit", () => {
    expect(parseRecurringArguments("30s check ci")).toEqual({
      action: "start",
      intervalMs: 30_000,
      prompt: "check ci",
    })
    expect(parseRecurringArguments("5m drain the queue")).toEqual({
      action: "start",
      intervalMs: 300_000,
      prompt: "drain the queue",
    })
    expect(parseRecurringArguments("1h summarize failures")).toEqual({
      action: "start",
      intervalMs: 3_600_000,
      prompt: "summarize failures",
    })
  })

  test("keeps multiline prompts intact", () => {
    const parsed = parseRecurringArguments("5m check the deploy\nthen report status")
    expect(parsed).toMatchObject({ action: "start", prompt: "check the deploy\nthen report status" })
  })

  test("prose interval is an explicit error, never a silent loop", () => {
    const parsed = parseRecurringArguments("check ci every 5 minutes")
    expect(parsed.action).toBe("error")
    if (parsed.action === "error") expect(parsed.message).toContain('Unrecognized interval "check"')
  })

  test("enforces the 30s minimum and 24h maximum", () => {
    expect(parseRecurringArguments("5s too fast").action).toBe("error")
    expect(parseRecurringArguments("29s too fast").action).toBe("error")
    expect(parseRecurringArguments("25h too slow").action).toBe("error")
    expect(parseRecurringArguments("30s ok")).toMatchObject({ action: "start", intervalMs: MIN_LOOP_INTERVAL_MS })
    expect(parseRecurringArguments("24h ok")).toMatchObject({ action: "start", intervalMs: MAX_LOOP_INTERVAL_MS })
  })

  test("an interval without a prompt is an error", () => {
    const parsed = parseRecurringArguments("5m")
    expect(parsed.action).toBe("error")
    if (parsed.action === "error") expect(parsed.message).toContain("needs a prompt")
  })
})

describe("interval helpers", () => {
  test("parseLoopInterval handles units and rejects garbage", () => {
    expect(parseLoopInterval("45s")).toBe(45_000)
    expect(parseLoopInterval("2M")).toBe(120_000)
    expect(parseLoopInterval("3h")).toBe(10_800_000)
    expect(parseLoopInterval("5")).toBeUndefined()
    expect(parseLoopInterval("m5")).toBeUndefined()
    expect(parseLoopInterval("5d")).toBeUndefined()
    expect(parseLoopInterval("-5m")).toBeUndefined()
  })

  test("formatLoopInterval picks the largest exact unit", () => {
    expect(formatLoopInterval(30_000)).toBe("30s")
    expect(formatLoopInterval(300_000)).toBe("5m")
    expect(formatLoopInterval(3_600_000)).toBe("1h")
    expect(formatLoopInterval(90_000)).toBe("90s")
  })
})
