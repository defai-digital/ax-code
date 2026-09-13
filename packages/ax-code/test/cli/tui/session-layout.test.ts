import { describe, expect, test } from "vitest"
import { computeSessionMainPaneWidth, computeSidebarWidth } from "../../../src/cli/cmd/tui/routes/session/layout"

describe("session layout", () => {
  test("defaults the sidebar to 30 columns and honors width presets", () => {
    expect(computeSidebarWidth(80)).toBe(30)
    expect(computeSidebarWidth(200)).toBe(30)
    expect(computeSidebarWidth(200, 20)).toBe(20)
    expect(computeSidebarWidth(200, 40)).toBe(40)
    expect(computeSidebarWidth(200, 99)).toBe(30)
  })

  test("clamps a wide sidebar so the main pane stays usable", () => {
    expect(computeSidebarWidth(121, 40)).toBe(37)
  })

  test("subtracts sidebar width and gutter from the main pane", () => {
    expect(
      computeSessionMainPaneWidth({
        terminalWidth: 130,
        sidebarVisible: true,
      }),
    ).toBe(96)
    expect(
      computeSessionMainPaneWidth({
        terminalWidth: 130,
        sidebarVisible: true,
        sidebarPreferredWidth: 40,
      }),
    ).toBe(86)
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
