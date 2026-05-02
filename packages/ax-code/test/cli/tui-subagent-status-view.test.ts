import { describe, expect, test } from "bun:test"
import { buildSubagentStatusView } from "../../src/cli/cmd/tui/routes/session/subagent-status-view"

describe("buildSubagentStatusView", () => {
  test("rolls child session activity into a parent-visible active subagent label", () => {
    const now = 120_000
    const view = buildSubagentStatusView({
      now,
      parentSessionID: "parent",
      childSessions: [{ id: "child", parentID: "parent", title: "Review code" }],
      tasks: [
        {
          id: "part",
          sessionID: "child",
          title: "Review code",
          agent: "reviewer",
          status: "running",
          startedAt: 30_000,
          lastActivityAt: 110_000,
        },
      ],
      statuses: {
        child: {
          type: "busy",
          startedAt: 30_000,
          lastActivityAt: 110_000,
          waitState: "tool",
          activeTool: "bash",
        },
      },
    })

    expect(view.running).toBe(1)
    expect(view.done).toBe(0)
    expect(view.total).toBe(1)
    expect(view.items[0]?.active).toBe(true)
    expect(view.items[0]?.stale).toBe(false)
    expect(view.items[0]?.label).toBe("reviewer: Running command · 1m30s")
  })

  test("marks active subagents stale when the child session has no recent activity", () => {
    const now = 240_000
    const view = buildSubagentStatusView({
      now,
      parentSessionID: "parent",
      staleAfterMs: 90_000,
      childSessions: [{ id: "child", parentID: "parent", title: "Explore code" }],
      tasks: [
        {
          id: "part",
          sessionID: "child",
          agent: "explorer",
          status: "running",
          startedAt: 10_000,
          lastActivityAt: 20_000,
        },
      ],
      statuses: {
        child: {
          type: "busy",
          startedAt: 10_000,
          lastActivityAt: 20_000,
          waitState: "llm",
        },
      },
    })

    expect(view.items[0]?.stale).toBe(true)
    expect(view.items[0]?.label).toBe("explorer: Thinking · 3m50s · no update 3m40s")
  })

  test("falls back to task timing when child busy status omits timestamps", () => {
    const now = 200_000
    const view = buildSubagentStatusView({
      now,
      parentSessionID: "parent",
      staleAfterMs: 90_000,
      childSessions: [{ id: "child", parentID: "parent", title: "Inspect code" }],
      tasks: [
        {
          id: "part",
          sessionID: "child",
          agent: "explorer",
          status: "running",
          startedAt: 50_000,
          lastActivityAt: 80_000,
        },
      ],
      statuses: {
        child: {
          type: "busy",
          waitState: "tool",
          activeTool: "grep",
        },
      },
    })

    expect(view.items[0]?.stale).toBe(true)
    expect(view.items[0]?.label).toBe("explorer: Scanning files · 2m30s · no update 2m00s")
  })

  test("shows a starting item before the task is bound to a child session", () => {
    const view = buildSubagentStatusView({
      now: 15_000,
      parentSessionID: "parent",
      childSessions: [],
      tasks: [
        {
          id: "part",
          agent: "reviewer",
          status: "running",
          startedAt: 10_000,
          lastActivityAt: 10_000,
        },
      ],
      statuses: {},
    })

    expect(view.running).toBe(1)
    expect(view.total).toBe(1)
    expect(view.items[0]?.active).toBe(true)
    expect(view.items[0]?.label).toBe("reviewer: Starting · 5s")
  })

  test("keeps completed subagents visible without treating them as active", () => {
    const view = buildSubagentStatusView({
      now: 80_000,
      parentSessionID: "parent",
      childSessions: [{ id: "child", parentID: "parent" }],
      tasks: [
        {
          id: "part",
          sessionID: "child",
          agent: "reviewer",
          status: "completed",
          startedAt: 10_000,
          lastActivityAt: 70_000,
        },
      ],
      statuses: {},
    })

    expect(view.running).toBe(0)
    expect(view.done).toBe(1)
    expect(view.items[0]?.active).toBe(false)
    expect(view.items[0]?.done).toBe(true)
    expect(view.items[0]?.label).toBe("reviewer: Completed · 1m10s")
  })
})
