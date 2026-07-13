import { describe, expect, test } from "vitest"
import {
  cycleWorkMode,
  DEFAULT_WORK_MODE,
  resolveWorkModeSend,
  routeWorkModeInput,
  workModeChipColorHex,
} from "./workMode"

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

  test("strips leading whitespace so slash commands still route", () => {
    expect(routeWorkModeInput("arena", "  /help")).toEqual({ kind: "prompt", text: "/help" })
    expect(routeWorkModeInput("council", "\n/model gpt")).toEqual({ kind: "prompt", text: "/model gpt" })
  })

  test("resolveWorkModeSend forces council/arena and normalizes slashes", () => {
    expect(resolveWorkModeSend("agent", "  /help")).toEqual({
      content: "/help",
      forcedCommand: null,
    })
    expect(resolveWorkModeSend("council", "rate quality")).toEqual({
      content: "/council rate quality",
      forcedCommand: { name: "council", arguments: "rate quality" },
    })
    expect(resolveWorkModeSend("arena", "compare plans")).toEqual({
      content: "/arena compare plans",
      forcedCommand: { name: "arena", arguments: "compare plans" },
    })
    expect(resolveWorkModeSend("arena", "  /sessions")).toEqual({
      content: "/sessions",
      forcedCommand: null,
    })
  })

  test("chip colors are fixed green / blue / purple", () => {
    expect(workModeChipColorHex("agent")).toBe("#22c55e")
    expect(workModeChipColorHex("council")).toBe("#3b82f6")
    expect(workModeChipColorHex("arena")).toBe("#a855f7")
  })
})
