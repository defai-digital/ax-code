import { describe, expect, test } from "bun:test"
import { computeSessionMainPaneWidth, computeSidebarWidth } from "../../../src/cli/cmd/tui/routes/session/layout"

describe("session layout", () => {
  test("uses the documented three-tier sidebar widths", () => {
    expect(computeSidebarWidth(150)).toBe(42)
    expect(computeSidebarWidth(160)).toBe(46)
    expect(computeSidebarWidth(200)).toBe(52)
  })

  test("subtracts sidebar width and gutter from the main pane", () => {
    expect(
      computeSessionMainPaneWidth({
        terminalWidth: 160,
        sidebarVisible: true,
      }),
    ).toBe(110)
  })

  test("returns the full inner width when the sidebar is hidden", () => {
    expect(
      computeSessionMainPaneWidth({
        terminalWidth: 120,
        sidebarVisible: false,
      }),
    ).toBe(116)
  })
})
