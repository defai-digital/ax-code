import { describe, expect, test } from "vitest"
import { ModeProtocol } from "../../src/mode/protocol"

describe("ModeProtocol.renderExecutionModes", () => {
  test("renders execution_modes block", () => {
    const text = ModeProtocol.renderExecutionModes({
      defaultMode: "hybrid",
      councilEnabled: true,
      arenaEnabled: false,
      localAvailable: true,
    })
    expect(text).toContain("<execution_modes>")
    expect(text).toContain("</execution_modes>")
    expect(text).toContain("hybrid")
    expect(text).toContain("council")
    expect(text.toLowerCase()).toContain("verify")
  })

  test("notes arena off by default", () => {
    const text = ModeProtocol.renderExecutionModes({ arenaEnabled: false })
    expect(text.toLowerCase()).toMatch(/arena.*off|experimental\/off/)
  })

  test("requires early council/arena without task_parallel first", () => {
    const text = ModeProtocol.renderExecutionModes({ councilEnabled: true })
    expect(text).toContain("first 1–2 tool rounds")
    expect(text).toContain("task_parallel")
    expect(text.toLowerCase()).toContain("not a multi-provider ensemble")
  })

  test("renders the slim variant when council/arena are disabled and local is unavailable", () => {
    const text = ModeProtocol.renderExecutionModes({
      defaultMode: "cloud",
      councilEnabled: false,
      arenaEnabled: false,
      localAvailable: false,
    })
    expect(text).toContain("<execution_modes>")
    expect(text).toContain("Effective default mode: cloud.")
    expect(text).toContain("single-path implement + verify")
    expect(text).not.toContain("task_parallel")
    expect(text.split("\n")).toHaveLength(4)
  })

  test("keeps the full block when council is enabled even without arena or local", () => {
    const text = ModeProtocol.renderExecutionModes({
      councilEnabled: true,
      arenaEnabled: false,
      localAvailable: false,
    })
    expect(text).toContain("task_parallel")
  })
})
