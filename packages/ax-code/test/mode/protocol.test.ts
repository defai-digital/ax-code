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
})
