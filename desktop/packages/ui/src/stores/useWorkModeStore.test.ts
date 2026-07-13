import { beforeEach, describe, expect, test } from "vitest"
import { useWorkModeStore } from "./useWorkModeStore"

describe("useWorkModeStore", () => {
  beforeEach(() => {
    useWorkModeStore.setState({ modeByDirectory: {} })
  })

  test("defaults to agent", () => {
    expect(useWorkModeStore.getState().getMode("/repo")).toBe("agent")
    expect(useWorkModeStore.getState().getMode(null)).toBe("agent")
  })

  test("persists mode per directory key", () => {
    useWorkModeStore.getState().setMode("/repo", "council")
    expect(useWorkModeStore.getState().getMode("/repo")).toBe("council")
    expect(useWorkModeStore.getState().getMode("/other")).toBe("agent")
  })

  test("normalizes windows-style directory keys", () => {
    useWorkModeStore.getState().setMode("C:\\Repo\\", "arena")
    expect(useWorkModeStore.getState().getMode("c:/Repo")).toBe("arena")
  })
})
