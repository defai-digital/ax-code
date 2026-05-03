import { describe, expect, test } from "bun:test"
import {
  footerAgentControlStatusView,
  footerTrustChip,
  footerSessionStatusLabel,
  footerSessionStatusView,
  SESSION_STATUS_STALE_AFTER_MS,
  SESSION_STATUS_TOOL_STALE_AFTER_MS,
} from "../../src/cli/cmd/tui/routes/session/footer-view-model"

describe("footerAgentControlStatusView", () => {
  test("prioritizes open subagent calls over completion labels", () => {
    expect(
      footerAgentControlStatusView(
        {
          phase: "complete",
          completed: true,
          safety: {
            shadow: 0,
            ask: 0,
            deny: 0,
            checkpoint: 0,
          },
        },
        {
          totalCalls: 1,
          totalResults: 0,
          openCalls: [
            {
              callID: "call_task",
              tool: "task",
              sequence: 0,
              event: {
                type: "tool.call",
                sessionID: "ses_test" as any,
                tool: "task",
                callID: "call_task",
                input: {},
              },
            },
          ],
          openTaskCalls: [
            {
              callID: "call_task",
              tool: "task",
              sequence: 0,
              event: {
                type: "tool.call",
                sessionID: "ses_test" as any,
                tool: "task",
                callID: "call_task",
                input: {},
              },
            },
          ],
        },
      ),
    ).toEqual({
      label: "Agent waiting: 1 subagent",
      tone: "warning",
    })
  })

  test("summarizes active control-plane state without full replay details", () => {
    expect(
      footerAgentControlStatusView({
        phase: "plan",
        reasoningDepth: "deep",
        plan: {
          id: "plan_01",
          objective: "Implement v5 control plane",
          approvalState: "not_required",
          progress: {
            total: 2,
            completed: 1,
            blocked: 0,
            cancelled: 0,
            open: 1,
          },
        },
        safety: {
          shadow: 1,
          ask: 0,
          deny: 0,
          checkpoint: 1,
        },
      }),
    ).toEqual({
      label: "Agent Plan · deep reasoning · plan 1/2 · shadow safety 1",
      tone: "working",
    })
  })

  test("prioritizes blocked and completed states", () => {
    expect(
      footerAgentControlStatusView({
        phase: "blocked",
        blockedReason: "approval_pending_for_large_refactor",
        safety: {
          shadow: 0,
          ask: 0,
          deny: 0,
          checkpoint: 0,
        },
      }),
    ).toEqual({
      label: "Agent blocked: approval_pending_for_larg...",
      tone: "warning",
    })

    expect(
      footerAgentControlStatusView({
        phase: "complete",
        completed: true,
        safety: {
          shadow: 0,
          ask: 0,
          deny: 0,
          checkpoint: 0,
        },
      }),
    ).toEqual({
      label: "Agent complete",
      tone: "success",
    })
  })
})

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
    expect(view.shortLabel).toContain("Thinking")
    expect(view.tone).toBe("working")
    expect(view.label).not.toContain("no model output")
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
    expect(view.label).toContain("Thinking stalled")
    expect(view.shortLabel).toContain("Thinking stalled")
    expect(view.tone).toBe("warning")
    expect(view.label).toContain("no model output")
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
    expect(recentTool.label).toContain("Running command")
    expect(staleTool.stale).toBe(true)
    expect(staleTool.label).toContain("Running command stalled")
    expect(staleTool.label).toContain("no tool update")
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

describe("footerTrustChip", () => {
  test("shows plan count before ready state", () => {
    expect(
      footerTrustChip({
        experimentalDebugEngine: true,
        pendingPlans: 2,
        graphNodeCount: 10,
      }),
    ).toEqual({
      type: "plans",
      label: "2 Plans",
      count: 2,
    })
  })

  test("uses DRE wording for ready state", () => {
    expect(
      footerTrustChip({
        experimentalDebugEngine: true,
        pendingPlans: 0,
        graphNodeCount: 10,
      }),
    ).toEqual({
      type: "ready",
      label: "DRE ready",
      count: 0,
    })
  })
})
