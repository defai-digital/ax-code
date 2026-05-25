import { describe, expect, test } from "bun:test"
import { footerSessionStatusView } from "../../../src/cli/cmd/tui/routes/session/footer-view-model"

const DEFAULT_LLM_STALE_AFTER_MS = 60_000
const DEFAULT_TOOL_STALE_AFTER_MS = 90_000

describe("footerSessionStatusView", () => {
  test("labels recent llm work without marking it stale", () => {
    const now = 1_000_000
    const view = footerSessionStatusView({
      now,
      status: {
        type: "busy",
        startedAt: now - 15_000,
        lastActivityAt: now - 10_000,
        waitState: "llm",
      },
    })

    expect(view.stale).toBe(false)
    expect(view.label).toContain("Thinking")
    expect(view.tone).toBe("working")
    expect(view.label).not.toContain("no model output")
  })

  test("warns that llm work is taking longer after prolonged inactivity", () => {
    const now = 2_000_000
    const view = footerSessionStatusView({
      now,
      status: {
        type: "busy",
        startedAt: now - 95_000,
        lastActivityAt: now - DEFAULT_LLM_STALE_AFTER_MS - 5_000,
        waitState: "llm",
      },
    })

    expect(view.stale).toBe(true)
    expect(view.label).toContain("Still waiting for model")
    expect(view.tone).toBe("warning")
    expect(view.label).not.toContain("no model output")
    expect(view.label).not.toContain("stalled")
  })

  test("gives tools a longer inactivity budget before warning", () => {
    const now = 3_000_000
    const recentTool = footerSessionStatusView({
      now,
      status: {
        type: "busy",
        startedAt: now - 80_000,
        lastActivityAt: now - DEFAULT_LLM_STALE_AFTER_MS - 5_000,
        waitState: "tool",
        activeTool: "bash_tool",
      },
    })
    const staleTool = footerSessionStatusView({
      now,
      status: {
        type: "busy",
        startedAt: now - 120_000,
        lastActivityAt: now - DEFAULT_TOOL_STALE_AFTER_MS - 5_000,
        waitState: "tool",
        activeTool: "bash_tool",
      },
    })

    expect(recentTool.stale).toBe(false)
    expect(recentTool.label).toContain("Running command")
    expect(staleTool.stale).toBe(true)
    expect(staleTool.label).toContain("Still running command")
    expect(staleTool.label).toContain("no tool update")
    expect(staleTool.label).not.toContain("stalled")
  })

  test("describes file discovery tools as scanning files", () => {
    const now = 3_500_000
    const view = footerSessionStatusView({
      now,
      status: {
        type: "busy",
        startedAt: now - 8_000,
        lastActivityAt: now - 2_000,
        waitState: "tool",
        activeTool: "grep_tool",
      },
    })

    expect(view.label).toContain("Scanning files")
  })

  test("prioritizes todo tools before generic write/edit wording", () => {
    const now = 3_600_000
    const view = footerSessionStatusView({
      now,
      status: {
        type: "busy",
        startedAt: now - 8_000,
        lastActivityAt: now - 2_000,
        waitState: "tool",
        activeTool: "todowrite",
      },
    })

    expect(view.label).toContain("Updating todos")
  })

  test("uses thinking as the generic busy status", () => {
    const now = 3_700_000
    const view = footerSessionStatusView({
      now,
      status: {
        type: "busy",
        startedAt: now - 8_000,
        lastActivityAt: now - 2_000,
      },
    })

    expect(view.label).toContain("Thinking")
  })

  test("does not classify lsp as file listing", () => {
    const now = 3_800_000
    const view = footerSessionStatusView({
      now,
      status: {
        type: "busy",
        startedAt: now - 8_000,
        lastActivityAt: now - 2_000,
        waitState: "tool",
        activeTool: "lsp",
      },
    })

    expect(view.label).toContain("Analyzing code")
  })
  test("formats retry countdowns", () => {
    const now = 4_000_000
    const view = footerSessionStatusView({
      now,
      status: {
        type: "retry",
        attempt: 2,
        message: "temporary failure",
        next: now + 9_000,
      },
    })

    expect(view.label).toBe("Retrying in 9s")
  })
})
