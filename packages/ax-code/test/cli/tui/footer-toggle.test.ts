import { describe, expect, test } from "bun:test"
import { footerToggleLabel } from "../../../src/cli/cmd/tui/component/prompt/footer-toggle"

describe("footerToggleLabel", () => {
  test("keeps active and inactive labels the same width", () => {
    const active = footerToggleLabel("Autonomous", true)
    const inactive = footerToggleLabel("Autonomous", false)

    expect(active).toBe(" ● Autonomous ")
    expect(inactive).toBe(" ○ Autonomous ")
    expect(active.length).toBe(inactive.length)
  })

  test("pads every toggle chip consistently", () => {
    expect(footerToggleLabel("Auto-route", true)).toBe(" ● Auto-route ")
    expect(footerToggleLabel("Sandbox", false)).toBe(" ○ Sandbox ")
  })
})
