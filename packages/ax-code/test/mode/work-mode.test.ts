import { describe, expect, test } from "vitest"
import { WorkMode } from "../../src/mode/work-mode"

describe("WorkMode", () => {
  test("defaults and cycle", () => {
    expect(WorkMode.DEFAULT).toBe("agent")
    expect(WorkMode.cycle("agent")).toBe("council")
    expect(WorkMode.cycle("council")).toBe("arena")
    expect(WorkMode.cycle("arena")).toBe("agent")
  })

  test("chip colors are fixed green / blue / purple (not theme-dependent)", () => {
    expect(WorkMode.chipColorHex("agent")).toBe("#22c55e")
    expect(WorkMode.chipColorHex("council")).toBe("#3b82f6")
    expect(WorkMode.chipColorHex("arena")).toBe("#a855f7")
  })

  test("routeInput leaves agent free-text unchanged", () => {
    const r = WorkMode.routeInput("agent", "fix the bug")
    expect(r).toEqual({ kind: "prompt", text: "fix the bug" })
  })

  test("routeInput maps council/arena free-text to commands", () => {
    expect(WorkMode.routeInput("council", "rate quality")).toEqual({
      kind: "command",
      command: "council",
      arguments: "rate quality",
    })
    expect(WorkMode.routeInput("arena", "compare approaches")).toEqual({
      kind: "command",
      command: "arena",
      arguments: "compare approaches",
    })
  })

  test("routeInput preserves explicit slash commands", () => {
    expect(WorkMode.routeInput("council", "/model")).toEqual({ kind: "prompt", text: "/model" })
    expect(WorkMode.routeInput("arena", "/sessions")).toEqual({ kind: "prompt", text: "/sessions" })
  })
})
