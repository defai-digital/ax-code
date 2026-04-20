import { describe, expect, test } from "bun:test"
import {
  footerSessionStatusLabel,
  footerSessionStatusView,
  SESSION_STATUS_STALE_AFTER_MS,
  SESSION_STATUS_TOOL_STALE_AFTER_MS,
} from "../../src/cli/cmd/tui/routes/session/footer-view-model"

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
    expect(view.label).toContain("Waiting for model")
    expect(view.label).not.toContain("no activity")
  })

  test("marks stalled llm work after prolonged inactivity", () => {
    const now = 2_000_000
    const view = footerSessionStatusView({
      now,
      status: {
        type: "busy",
        startedAt: now - 95_000,
        lastActivityAt: now - SESSION_STATUS_STALE_AFTER_MS - 5_000,
        waitState: "llm",
      },
    })

    expect(view.stale).toBe(true)
    expect(view.label).toContain("Waiting for model")
    expect(view.label).toContain("no activity")
  })

  test("gives tools a longer inactivity budget before warning", () => {
    const now = 3_000_000
    const recentTool = footerSessionStatusView({
      now,
      status: {
        type: "busy",
        startedAt: now - 80_000,
        lastActivityAt: now - SESSION_STATUS_STALE_AFTER_MS - 5_000,
        waitState: "tool",
        activeTool: "bash_tool",
      },
    })
    const staleTool = footerSessionStatusView({
      now,
      status: {
        type: "busy",
        startedAt: now - 120_000,
        lastActivityAt: now - SESSION_STATUS_TOOL_STALE_AFTER_MS - 5_000,
        waitState: "tool",
        activeTool: "bash_tool",
      },
    })

    expect(recentTool.stale).toBe(false)
    expect(recentTool.label).toContain("Running Bash Tool")
    expect(staleTool.stale).toBe(true)
    expect(staleTool.label).toContain("no activity")
  })
})

describe("footerSessionStatusLabel", () => {
  test("formats retry countdowns", () => {
    const now = 4_000_000
    expect(
      footerSessionStatusLabel({
        now,
        status: {
          type: "retry",
          attempt: 2,
          message: "temporary failure",
          next: now + 9_000,
        },
      }),
    ).toBe("Retrying in 9s")
  })
})
