import { describe, expect, test } from "vitest"
import {
  hasNewActiveSubagent,
  subagentPanelLayout,
} from "../../../src/cli/cmd/tui/routes/session/subagent-panel-layout"
import {
  buildSubagentStatusView,
  isGoalPlanning,
  subagentPanelHeaderSummary,
  subagentPanelItems,
} from "../../../src/cli/cmd/tui/routes/session/subagent-status-view"

describe("active subagent visibility", () => {
  test("keeps a status summary when collapsed and gives one active task two body rows", () => {
    expect(subagentPanelLayout({ terminalHeight: 24, activeCount: 1, collapsed: true }).rows).toBe(2)
    expect(subagentPanelLayout({ terminalHeight: 24, activeCount: 1, collapsed: false })).toEqual({
      rows: 4,
      visible: 1,
      hidden: 0,
    })
  })
  test("bounds the expanded panel and accounts for overflow and hidden state", () => {
    for (const terminalHeight of [16, 24, 40, 60, 100]) {
      const view = subagentPanelLayout({ terminalHeight, activeCount: 20, collapsed: false })
      expect(view.rows).toBeLessThanOrEqual(Math.max(5, Math.min(10, Math.floor(terminalHeight * 0.25))))
      expect(view.visible + view.hidden).toBe(20)
      expect(view.rows).toBe(2 + view.visible * 2 + 1)
    }
    expect(subagentPanelLayout({ terminalHeight: 24, activeCount: 0, collapsed: false }).rows).toBe(0)
  })
  test("only new active children reopen a manually collapsed panel", () => {
    const previous = new Set(["a", "b"])
    expect(hasNewActiveSubagent(previous, ["b", "a"])).toBe(false)
    expect(hasNewActiveSubagent(previous, ["a"])).toBe(false)
    expect(hasNewActiveSubagent(previous, [])).toBe(false)
    expect(hasNewActiveSubagent(previous, ["a", "c"])).toBe(true)
  })
  test("keeps the planner first and replaces its internal agent name with activity", () => {
    const view = buildSubagentStatusView({
      parentSessionID: "parent",
      now: 65000,
      tasks: [],
      childSessions: [
        { id: "explore", parentID: "parent", title: "Explore code", agent: "explore" },
        { id: "plan", parentID: "parent", title: "Goal plan writer", agent: "goal-plan-writer" },
      ],
      statuses: {
        explore: { type: "busy", waitState: "llm" },
        plan: { type: "busy", startedAt: 1000, lastActivityAt: 60000, waitState: "tool", activeTool: "read" },
      },
    })
    expect(subagentPanelItems(view)[0].sessionID).toBe("plan")
    expect(subagentPanelHeaderSummary(view)).toBe("Scanning files · 1m04s")
  })

  test("recognizes actual goal planning without labeling ordinary goal-related work as planning", () => {
    function view(title: string, active: boolean) {
      return buildSubagentStatusView({
        parentSessionID: "parent",
        tasks: [],
        childSessions: [{ id: "child", parentID: "parent", title }],
        statuses: { child: active ? { type: "busy", waitState: "llm" } : { type: "idle" } },
      })
    }
    expect(isGoalPlanning(view("Goal plan writer", true))).toBe(true)
    expect(isGoalPlanning(view("Goal plan writer", false))).toBe(false)
    expect(isGoalPlanning(view("Review goal implementation", true))).toBe(false)
  })
})
