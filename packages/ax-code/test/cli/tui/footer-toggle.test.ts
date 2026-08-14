import { describe, expect, test } from "vitest"
import { footerToggleLabel } from "../../../src/cli/cmd/tui/component/prompt/footer-toggle"

describe("footerToggleLabel", () => {
  test("keeps active and inactive labels the same width", () => {
    const active = footerToggleLabel("Auto", true)
    const inactive = footerToggleLabel("Auto", false)

    expect(active).toBe(" ● Auto ")
    expect(inactive).toBe(" ○ Auto ")
    expect(active.length).toBe(inactive.length)
  })

  test("pads every toggle chip consistently", () => {
    expect(footerToggleLabel("Auto-route", true)).toBe(" ● Auto-route ")
    expect(footerToggleLabel("Sandbox", false)).toBe(" ○ Sandbox ")
  })
})
