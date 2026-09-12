import { describe, expect, test } from "vitest"
import {
  buildSubagentStatusView,
  hasActiveGoalPlanner,
  isGoalPlanning,
  mergeSubagentRollupTasks,
  queueItemsForSessionTree,
  queueStatusToTaskStatus,
  subagentPanelHeaderSummary,
  subagentPanelTitle,
  subagentSoloDetails,
  subagentSoloTitle,
  taskQueueItemsToRollupTasks,
} from "../../../src/cli/cmd/tui/routes/session/subagent-status-view"

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

  test("keeps child session activity visible before a task part is bound", () => {
    const view = buildSubagentStatusView({
      now: 40_000,
      parentSessionID: "parent",
      childSessions: [{ id: "child", parentID: "parent", title: "Investigate startup" }],
      tasks: [],
      statuses: {
        child: {
          type: "busy",
          startedAt: 20_000,
          lastActivityAt: 35_000,
          waitState: "llm",
        },
      },
    })

    expect(view.running).toBe(1)
    expect(view.done).toBe(0)
    expect(view.total).toBe(1)
    expect(view.items[0]?.active).toBe(true)
    expect(view.items[0]?.title).toBe("Investigate startup")
    expect(view.items[0]?.label).toBe("Thinking · 20s")
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
    expect(view.items[0]?.label).toBe("reviewer: Completed · 1m00s")
  })

  test("maps TaskQueue rows onto the same rollup as live task parts", () => {
    const queueTasks = taskQueueItemsToRollupTasks([
      {
        id: "task_queue_1",
        sessionID: "child",
        kind: "subagent",
        status: "running",
        title: "Review PR",
        agent: "reviewer",
        model: { modelID: "kimi-k2", providerID: "moonshot" },
        time: { started: 10_000, updated: 40_000 },
      },
      {
        id: "task_queue_prompt",
        sessionID: "other",
        kind: "prompt",
        status: "running",
        title: "Should be ignored",
      },
    ])

    expect(queueTasks).toHaveLength(1)
    expect(queueTasks[0]).toMatchObject({
      sessionID: "child",
      title: "Review PR",
      agent: "reviewer",
      modelID: "kimi-k2",
      status: "running",
    })

    const view = buildSubagentStatusView({
      now: 50_000,
      parentSessionID: "parent",
      childSessions: [{ id: "child", parentID: "parent", title: "Review PR (@reviewer subagent)" }],
      tasks: queueTasks,
      statuses: {
        child: {
          type: "busy",
          startedAt: 10_000,
          lastActivityAt: 45_000,
          waitState: "llm",
        },
      },
    })

    expect(view.running).toBe(1)
    expect(view.items[0]?.title).toBe("Review PR")
    expect(view.items[0]?.model).toBe("kimi-k2")
    expect(view.items[0]?.label).toBe("reviewer: Thinking · 40s")
  })

  test("prefers a live tool-part task when a queue row shares the session", () => {
    const merged = mergeSubagentRollupTasks(
      [
        {
          id: "part",
          sessionID: "child",
          title: "From tool",
          agent: "explore",
          status: "running",
        },
      ],
      [
        {
          id: "queue",
          sessionID: "child",
          title: "From queue",
          agent: "reviewer",
          status: "pending",
        },
      ],
    )

    expect(merged).toHaveLength(1)
    expect(merged[0]?.title).toBe("From tool")
    expect(merged[0]?.agent).toBe("explore")
  })

  test("a completed tool part does not hide a follow-up queue row for the same session", () => {
    const merged = mergeSubagentRollupTasks(
      [
        {
          id: "part",
          sessionID: "child",
          title: "From tool",
          agent: "explore",
          status: "completed",
        },
      ],
      [
        {
          id: "queue",
          sessionID: "child",
          title: "From queue",
          agent: "reviewer",
          status: "running",
        },
      ],
    )

    expect(merged).toHaveLength(1)
    expect(merged[0]?.title).toBe("From queue")
    expect(merged[0]?.agent).toBe("reviewer")
  })

  test("keeps queue rows scoped to the current session tree", () => {
    const scoped = queueItemsForSessionTree(
      [
        { id: "a", sessionID: "child", kind: "subagent" },
        { id: "b", sessionID: "foreign", kind: "subagent" },
        { id: "c", kind: "automation" },
      ],
      { parentSessionID: "parent", childSessionIDs: ["child"] },
    )

    expect(scoped.map((item) => item.id)).toEqual(["a", "c"])
  })

  test("maps queue lifecycle statuses onto rollup task statuses", () => {
    expect(queueStatusToTaskStatus("waiting_for_idle")).toBe("pending")
    expect(queueStatusToTaskStatus("blocked_permission")).toBe("running")
    expect(queueStatusToTaskStatus("failed")).toBe("error")
    expect(queueStatusToTaskStatus("cancelled")).toBe("cancelled")
  })
})

describe("subagentPanelTitle", () => {
  test("uses the singular form for exactly one active subagent", () => {
    expect(subagentPanelTitle(1)).toBe("Subagent")
    expect(subagentPanelTitle(2)).toBe("Subagents 2")
    expect(subagentPanelTitle(0)).toBe("Subagents 0")
  })
})

describe("subagentPanelHeaderSummary", () => {
  test("returns the lead active item's label so a collapsed panel still informs", () => {
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
        child: { type: "busy", startedAt: 30_000, lastActivityAt: 110_000, waitState: "tool", activeTool: "bash" },
      },
    })

    expect(subagentPanelHeaderSummary(view)).toBe("reviewer: Running command · 1m30s")
  })

  test("includes the stale marker when the lead subagent stops reporting", () => {
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
        child: { type: "busy", startedAt: 10_000, lastActivityAt: 20_000, waitState: "llm" },
      },
    })

    expect(subagentPanelHeaderSummary(view)).toBe("explorer: Thinking · 3m50s · no update 3m40s")
  })

  test("returns undefined when nothing is active", () => {
    expect(subagentPanelHeaderSummary({ running: 0, done: 1, failed: 0, total: 1, items: [] })).toBeUndefined()
  })
})

describe("hasActiveGoalPlanner", () => {
  const parent = "parent"
  const writer = {
    id: "plan",
    parentID: parent,
    title: "Goal plan writer",
    agent: "goal-plan-writer" as const,
  }

  test("is true while the goal-plan-writer child is busy or retrying", () => {
    expect(
      hasActiveGoalPlanner({
        parentSessionID: parent,
        childSessions: [writer],
        statuses: { plan: { type: "busy", waitState: "llm" } },
      }),
    ).toBe(true)
    expect(
      hasActiveGoalPlanner({
        parentSessionID: parent,
        childSessions: [writer],
        statuses: { plan: { type: "retry", attempt: 1, message: "wait", next: 1 } },
      }),
    ).toBe(true)
  })

  test("is false once the writer child is idle (failed or finished)", () => {
    expect(
      hasActiveGoalPlanner({
        parentSessionID: parent,
        childSessions: [writer],
        statuses: { plan: { type: "idle" } },
      }),
    ).toBe(false)
  })

  test("ignores non-planner children and writers of other parents", () => {
    expect(
      hasActiveGoalPlanner({
        parentSessionID: parent,
        childSessions: [{ id: "explore", parentID: parent, title: "Explore code", agent: "explore" }],
        statuses: { explore: { type: "busy", waitState: "llm" } },
      }),
    ).toBe(false)
    expect(
      hasActiveGoalPlanner({
        parentSessionID: parent,
        childSessions: [{ ...writer, parentID: "other" }],
        statuses: { plan: { type: "busy", waitState: "llm" } },
      }),
    ).toBe(false)
  })

  test("agrees with isGoalPlanning on the same inputs", () => {
    const input = {
      parentSessionID: parent,
      tasks: [],
      childSessions: [writer],
      statuses: { plan: { type: "busy" as const, waitState: "llm" as const } },
    }
    expect(hasActiveGoalPlanner(input)).toBe(isGoalPlanning(buildSubagentStatusView(input)))
  })
})

describe("subagentSoloTitle", () => {
  test("replaces the planner's internal name and keeps other titles", () => {
    const view = buildSubagentStatusView({
      parentSessionID: "parent",
      now: 65_000,
      tasks: [],
      childSessions: [
        { id: "plan", parentID: "parent", title: "Goal plan writer", agent: "goal-plan-writer" },
        { id: "explore", parentID: "parent", title: "Explore code", agent: "explore" },
      ],
      statuses: {
        plan: { type: "busy", startedAt: 1_000, lastActivityAt: 60_000, waitState: "llm" },
        explore: { type: "busy", waitState: "tool", activeTool: "read" },
      },
    })
    const planner = view.items.find((item) => item.id === "plan")!
    const explore = view.items.find((item) => item.id === "explore")!
    expect(subagentSoloTitle(planner)).toBe("Planning goal")
    expect(subagentSoloTitle(explore)).toBe("Explore code")
    expect(subagentSoloDetails(planner)).toBe("Thinking - 1m04s")
  })
})
