import { describe, expect, test } from "vitest"
import { stringWidth } from "../../../src/bun/node-compat"
import {
  homeCompactHeaderPlan,
  homeStatusBarLayout,
  homeStatusBarMcpWidth,
  homeStatusBarPlan,
  homeWorkspaceLabel,
} from "../../../src/cli/tui/routes/home-layout"

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

describe("home workspace label", () => {
  test("abbreviates to the final path segment, keeping the branch suffix", () => {
    expect(homeWorkspaceLabel("~/code/_worktrees/ax-tui-glm:tui-ux")).toBe("ax-tui-glm:tui-ux")
    expect(homeWorkspaceLabel("/Users/dev/projects/ax-code/")).toBe("ax-code")
    expect(homeWorkspaceLabel("solo-project")).toBe("solo-project")
    expect(homeWorkspaceLabel("C:\\dev\\proj")).toBe("proj")
    expect(homeWorkspaceLabel("/")).toBe("/")
  })
})

describe("home status bar plan", () => {
  // 65 columns; the abbreviated project label is "ax-code-tui-ux-glm" (18).
  const LONG_PATH = "/Users/developer/very/deeply/nested/worktrees/ax-code-tui-ux-glm"

  test("120x40 keeps the full workspace path inline", () => {
    expect(homeStatusBarPlan({ terminalWidth: 120, directory: LONG_PATH, mcpWidth: 15, versionWidth: 6 })).toEqual({
      workspace: LONG_PATH,
      showVersion: true,
      stacked: false,
    })
  })

  test("80x24 abbreviates to the project label instead of stacking", () => {
    expect(homeStatusBarPlan({ terminalWidth: 80, directory: LONG_PATH, mcpWidth: 15, versionWidth: 6 })).toEqual({
      workspace: "ax-code-tui-ux-glm",
      showVersion: true,
      stacked: false,
    })
  })

  test("50x20 drops the version before stacking the essentials", () => {
    // Project segment is 27 columns: label+MCP fit one row, label+MCP+version do not.
    const directory = "/worktrees/ax-code-tui-ux-glm-longpath"
    expect(homeStatusBarPlan({ terminalWidth: 50, directory, mcpWidth: 15, versionWidth: 6 })).toEqual({
      workspace: "ax-code-tui-ux-glm-longpath",
      showVersion: false,
      stacked: false,
    })
  })

  test("a directory without separators falls through to dropping the version", () => {
    expect(homeStatusBarPlan({ terminalWidth: 40, directory: "solo-project", mcpWidth: 15, versionWidth: 6 })).toEqual({
      workspace: "solo-project",
      showVersion: false,
      stacked: false,
    })
  })

  test("stacks only when the essentials cannot fit, keeping the version hidden", () => {
    // Label (18) + MCP (15) + padding/gap needs 39 columns.
    const at39 = homeStatusBarPlan({ terminalWidth: 39, directory: LONG_PATH, mcpWidth: 15, versionWidth: 6 })
    expect(at39).toEqual({ workspace: "ax-code-tui-ux-glm", showVersion: false, stacked: false })
    const at38 = homeStatusBarPlan({ terminalWidth: 38, directory: LONG_PATH, mcpWidth: 15, versionWidth: 6 })
    expect(at38).toEqual({ workspace: "ax-code-tui-ux-glm", showVersion: false, stacked: true })
  })

  test("clamps an oversized project segment so the stacked label cannot wrap its row", () => {
    const directory = "/worktrees/ax-code-tui-ux-glm-very-long-worktree-name"
    const plan = homeStatusBarPlan({ terminalWidth: 30, directory, mcpWidth: 15, versionWidth: 6 })
    expect(plan.stacked).toBe(true)
    expect(plan.showVersion).toBe(false)
    expect(stringWidth(plan.workspace)).toBe(30 - 4)
    expect(plan.workspace.endsWith("...")).toBe(true)
  })

  test("zero-width MCP stays hidden and a full path fits when it can", () => {
    expect(homeStatusBarPlan({ terminalWidth: 77, directory: LONG_PATH, mcpWidth: 0, versionWidth: 6 })).toEqual({
      workspace: LONG_PATH,
      showVersion: true,
      stacked: false,
    })
    expect(homeStatusBarPlan({ terminalWidth: 75, directory: LONG_PATH, mcpWidth: 0, versionWidth: 6 })).toEqual({
      workspace: "ax-code-tui-ux-glm",
      showVersion: true,
      stacked: false,
    })
  })
})

describe("home compact header plan", () => {
  const base = { heading: "New task", agent: "Build", sessions: "Sessions" }

  test("120x40 and 80x24 keep the agent prefix and full labels", () => {
    for (const terminalWidth of [120, 80]) {
      expect(homeCompactHeaderPlan({ ...base, terminalWidth, model: "claude-sonnet-4.5" })).toEqual({
        showAgent: true,
        model: "claude-sonnet-4.5",
        sessions: "Sessions",
      })
    }
  })

  test("50x20 keeps a short model with its agent prefix", () => {
    expect(homeCompactHeaderPlan({ ...base, terminalWidth: 50, model: "sonnet-4.5" })).toEqual({
      showAgent: true,
      model: "sonnet-4.5",
      sessions: "Sessions",
    })
  })

  test("50x20 drops the agent prefix and truncates a long model id, never Sessions", () => {
    const plan = homeCompactHeaderPlan({ ...base, terminalWidth: 50, model: "defai-01-ax-trust-com/glm-5.3-preview" })
    expect(plan.showAgent).toBe(false)
    expect(plan.sessions).toBe("Sessions")
    expect(plan.model.startsWith("defai-01-ax-trust-com/")).toBe(true)
    expect(stringWidth(plan.model)).toBe(50 - 4 - stringWidth("New task") - 2 - stringWidth("Sessions"))
    expect(plan.model.endsWith("...")).toBe(true)
  })

  test("shows the agent prefix exactly when the full group fits", () => {
    // "Build · " (8) + gap (2) + "sonnet-4.5" (10) needs available 20 → width 42.
    expect(homeCompactHeaderPlan({ ...base, terminalWidth: 42, model: "sonnet-4.5" }).showAgent).toBe(true)
    const narrow = homeCompactHeaderPlan({ ...base, terminalWidth: 41, model: "sonnet-4.5" })
    expect(narrow.showAgent).toBe(false)
    expect(narrow.model).toBe("sonnet-4.5")
  })

  test("degenerate width keeps Sessions and shrinks the model to its budget", () => {
    const plan = homeCompactHeaderPlan({ ...base, terminalWidth: 24, model: "defai-01-ax-trust-com/glm-5.3-preview" })
    expect(plan.sessions).toBe("Sessions")
    expect(plan.showAgent).toBe(false)
    expect(stringWidth(plan.model)).toBeLessThanOrEqual(2)
  })
})
