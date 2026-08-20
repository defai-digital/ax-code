import { describe, expect, test } from "vitest"
import { homeStatusBarLayout, homeStatusBarMcpWidth } from "../../../src/cli/cmd/tui/routes/home-layout"

describe("home status bar layout", () => {
  test("keeps the row inline at its exact required width and stacks below it", () => {
    const segmentWidths = [20, 14, 31, 6]
    // Four columns of horizontal padding plus three two-column gaps.
    const required = 4 + segmentWidths.reduce((sum, width) => sum + width, 0) + 3 * 2

    expect(homeStatusBarLayout({ terminalWidth: required, segmentWidths }).stacked).toBe(false)
    expect(homeStatusBarLayout({ terminalWidth: required - 1, segmentWidths }).stacked).toBe(true)
  })

  test("ignores hidden segments and accounts for multi-digit MCP counts", () => {
    expect(homeStatusBarLayout({ terminalWidth: 12, segmentWidths: [3, 0, 3] }).stacked).toBe(false)
    expect(homeStatusBarMcpWidth(9)).toBe(15)
    expect(homeStatusBarMcpWidth(10)).toBe(16)
  })
})
