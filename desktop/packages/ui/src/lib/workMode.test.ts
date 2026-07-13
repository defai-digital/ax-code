import { describe, expect, test } from "vitest"
import { cycleWorkMode, DEFAULT_WORK_MODE, routeWorkModeInput } from "./workMode"

describe("workMode", () => {
  test("default is agent", () => {
    expect(DEFAULT_WORK_MODE).toBe("agent")
  })

  test("cycles agent → council → arena → agent on one control", () => {
    // Single toggle: each click advances one mode (Desktop + TUI).
    expect(cycleWorkMode("agent")).toBe("council")
    expect(cycleWorkMode("council")).toBe("arena")
    expect(cycleWorkMode("arena")).toBe("agent")
  })

  test("routes free text by mode", () => {
    expect(routeWorkModeInput("agent", "hello")).toEqual({ kind: "prompt", text: "hello" })
    expect(routeWorkModeInput("council", "review auth")).toEqual({
      kind: "command",
      command: "council",
      arguments: "review auth",
    })
  })

  test("keeps slash commands intact", () => {
    expect(routeWorkModeInput("council", "/help")).toEqual({ kind: "prompt", text: "/help" })
  })
})
