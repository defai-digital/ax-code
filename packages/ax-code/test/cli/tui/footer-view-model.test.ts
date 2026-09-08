import { describe, expect, test } from "vitest"
import { footerSessionStatusView } from "../../../src/cli/cmd/tui/routes/session/footer-view-model"

const DEFAULT_LLM_STALE_AFTER_MS = 60_000
const DEFAULT_TOOL_STALE_AFTER_MS = 90_000

describe("footerSessionStatusView", () => {
  test("keeps request elapsed time across model rounds without changing inactivity detection", () => {
    const messages = [
      { id: "u1", role: "user", time: { created: 100_000 } },
      { id: "a1", role: "assistant", parentID: "u1", time: { created: 101_000 } },
      { id: "a2", role: "assistant", parentID: "u1", time: { created: 220_000 } },
    ]
    const view = footerSessionStatusView({
      now: 280_000,
      messages,
      status: {
        type: "busy",
        startedAt: 220_000,
        lastActivityAt: 279_000,
        waitState: "tool",
        activeTool: "bash",
        step: 13,
        maxSteps: 100,
      },
    })

    expect(view.label).toBe("Running command - 3m")
    expect(view.stale).toBe(false)
    expect(view.label).not.toMatch(/remaining|ETA|%/)
  })

  test("starts a new request timer without including the previous request", () => {
    const view = footerSessionStatusView({
      now: 280_000,
      messages: [
        { id: "u1", role: "user", time: { created: 100_000 } },
        { id: "a1", role: "assistant", parentID: "u1", time: { created: 101_000 } },
        { id: "u2", role: "user", time: { created: 250_000 } },
        { id: "a2", role: "assistant", parentID: "u2", time: { created: 251_000 } },
      ],
      status: { type: "busy", startedAt: 270_000, waitState: "llm" },
    })
    expect(view.label).toBe("Thinking - 30s")
  })

  test.each([
    { messages: [] },
    { messages: [{ id: "a1", role: "assistant", parentID: "missing", time: { created: 100_000 } }] },
    {
      messages: [
        { id: "a1", role: "assistant", parentID: "u1", time: { created: 100_000 } },
        { id: "u2", role: "user", time: { created: 250_000 } },
      ],
    },
  ])("falls back to the operation timer without a linked current request (%#)", ({ messages }) => {
    const view = footerSessionStatusView({
      now: 280_000,
      messages,
      status: { type: "busy", startedAt: 270_000, waitState: "llm" },
    })
    expect(view.label).toBe("Thinking - 10s")
  })

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

  test("gives tools a longer inactivity budget without duplicating the elapsed time", () => {
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
    expect(staleTool.label).toBe("Still running command - 2m")
    expect(staleTool.label).not.toContain("no tool update")
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
