import { describe, expect, test } from "bun:test"
import { AgentControlReplayQuery } from "@/replay/agent-control-query"

describe("AgentControlReplayQuery", () => {
  test("builds a combined read model from replay rows", () => {
    const rows = [
      {
        event_data: {
          type: "agent.phase.changed",
          phase: "plan",
          reason: "planning is required before implementation",
        },
        time_created: 100,
      },
    ]

    expect(AgentControlReplayQuery.readModelFromRows(rows, "session-1")).toEqual({
      summary: AgentControlReplayQuery.summaryFromRows(rows),
      timeline: AgentControlReplayQuery.timelineFromRows(rows, "session-1"),
      tools: AgentControlReplayQuery.readModelFromEvents(rows.map((row) => row.event_data)).tools,
    })
  })

  test("identifies structurally valid agent-control replay events", () => {
    expect(
      AgentControlReplayQuery.normalizeAgentControlEvent({
        type: "agent.phase.changed",
        properties: {
          phase: "plan",
          reason: "planning is required before implementation",
        },
      }),
    ).toMatchObject({
      type: "agent.phase.changed",
      phase: "plan",
      reason: "planning is required before implementation",
    })
    expect(
      AgentControlReplayQuery.isAgentControlEvent({
        type: "agent.completed",
        validationStatus: "passed",
      }),
    ).toBe(true)
    expect(
      AgentControlReplayQuery.isAgentControlEvent({
        type: "agent.phase.changed",
        phase: "planning",
      }),
    ).toBe(false)
    expect(
      AgentControlReplayQuery.isAgentControlEvent({
        type: "agent.safety.decided",
        action: "prompt_user",
        risk: "high",
        reason: "unknown action should not enter the read model",
      }),
    ).toBe(false)
    expect(
      AgentControlReplayQuery.isAgentControlEvent({
        type: "agent.plan.updated",
        plan: {
          objective: "missing structural fields",
        },
      }),
    ).toBe(false)
    expect(
      AgentControlReplayQuery.isAgentControlEvent({
        type: "message.updated",
      }),
    ).toBe(false)
  })

  test("preserves replay row timestamps in timeline items", () => {
    expect(
      AgentControlReplayQuery.timelineFromRows(
        [
          {
            event_data: {
              type: "agent.completed",
              validationStatus: "passed",
            },
            time_created: 1234,
          },
        ],
        "session-1",
      ),
    ).toEqual([
      {
        id: "session-1:1234:0",
        eventType: "agent.completed",
        kind: "completed",
        title: "Completed",
        status: "completed",
        tone: "success",
        time: 1234,
        detail: "validation passed",
      },
    ])
  })

  test("filters non-control-plane events from timeline collections", () => {
    expect(
      AgentControlReplayQuery.timelineFromEvents([
        {
          type: "message.updated",
          properties: {},
        },
        {
          type: "agent.phase.changed",
          phase: "plan",
          reason: "planning is required before implementation",
        },
      ]),
    ).toEqual([
      {
        id: "event:1",
        eventType: "agent.phase.changed",
        kind: "phase",
        title: "Phase: Plan",
        status: "plan",
        tone: "working",
        detail: "planning is required before implementation",
      },
    ])
  })

  test("normalizes control-plane events into timeline items", () => {
    expect(
      AgentControlReplayQuery.timelineItemFromEvent(
        {
          type: "agent.plan.updated",
          plan: {
            id: "plan-1",
            objective: "Ship the control-plane bridge",
            approvalState: "approved",
            tasks: [{ status: "completed" }, { status: "blocked" }],
          },
        },
        "event-1",
      ),
    ).toEqual({
      id: "event-1",
      eventType: "agent.plan.updated",
      kind: "plan",
      title: "Plan: Ship the control-plane bridge",
      status: "approved",
      tone: "warning",
      detail: "1/2 tasks completed \u00B7 1 blocked \u00B7 approval approved",
    })
  })

  test("marks shadow safety decisions without treating them as enforcement", () => {
    expect(
      AgentControlReplayQuery.timelineItemFromEvent(
        {
          type: "agent.safety.decided",
          action: "ask",
          risk: "high",
          reason: "autonomous mode requires approval for shell commands",
          shadow: true,
        },
        "event-2",
      ),
    ).toEqual({
      id: "event-2",
      eventType: "agent.safety.decided",
      kind: "safety",
      title: "Safety: Shadow Ask",
      status: "ask",
      tone: "warning",
      detail: "autonomous mode requires approval for shell commands",
      shadow: true,
    })
  })

  test("renders reasoning timeline items with checkpoint detail", () => {
    expect(
      AgentControlReplayQuery.timelineItemFromEvent(
        {
          type: "agent.reasoning.selected",
          depth: "deep",
          reason: "planning_risk_signal",
          checkpoint: true,
        },
        "event-3",
      ),
    ).toEqual({
      id: "event-3",
      eventType: "agent.reasoning.selected",
      kind: "reasoning",
      title: "Reasoning: Deep",
      status: "deep",
      tone: "working",
      detail: "planning_risk_signal · checkpoint",
    })
  })

  test("renders reasoning timeline items without checkpoint when checkpoint is false", () => {
    expect(
      AgentControlReplayQuery.timelineItemFromEvent(
        {
          type: "agent.reasoning.selected",
          depth: "standard",
          reason: "small_request",
          checkpoint: false,
        },
        "event-4",
      ),
    ).toEqual({
      id: "event-4",
      eventType: "agent.reasoning.selected",
      kind: "reasoning",
      title: "Reasoning: Standard",
      status: "standard",
      tone: "muted",
      detail: "small_request",
    })
  })

  test("renders validation timeline items with correct tone for each status", () => {
    expect(
      AgentControlReplayQuery.timelineItemFromEvent(
        { type: "agent.validation.updated", status: "passed", reason: "all tests green" },
        "event-5",
      ),
    ).toMatchObject({ kind: "validation", title: "Validation: Passed", tone: "success" })

    expect(
      AgentControlReplayQuery.timelineItemFromEvent(
        { type: "agent.validation.updated", status: "failed" },
        "event-6",
      ),
    ).toMatchObject({ kind: "validation", tone: "warning" })

    expect(
      AgentControlReplayQuery.timelineItemFromEvent(
        { type: "agent.validation.updated", status: "pending" },
        "event-7",
      ),
    ).toMatchObject({ kind: "validation", tone: "working" })
  })

  test("renders blocked timeline items with recoverable detail", () => {
    expect(
      AgentControlReplayQuery.timelineItemFromEvent(
        { type: "agent.blocked", reason: "approval_required", recoverable: true },
        "event-8",
      ),
    ).toEqual({
      id: "event-8",
      eventType: "agent.blocked",
      kind: "blocked",
      title: "Blocked",
      status: "blocked",
      tone: "warning",
      detail: "approval_required · recoverable",
    })
  })

  test("renders blocked timeline items without recoverable suffix when non-recoverable", () => {
    expect(
      AgentControlReplayQuery.timelineItemFromEvent(
        { type: "agent.blocked", reason: "unrecoverable_error", recoverable: false },
        "event-9",
      ),
    ).toMatchObject({
      kind: "blocked",
      detail: "unrecoverable_error",
    })
  })

  test("renders plan timeline item as working tone when no tasks are blocked", () => {
    expect(
      AgentControlReplayQuery.timelineItemFromEvent(
        {
          type: "agent.plan.created",
          plan: {
            id: "plan-2",
            objective: "Build the feature",
            approvalState: "not_required",
            tasks: [{ status: "pending" }, { status: "completed" }],
          },
        },
        "event-10",
      ),
    ).toMatchObject({
      kind: "plan",
      title: "Plan: Build the feature",
      tone: "working",
      detail: "1/2 tasks completed · approval not_required",
    })
  })

  test("renders plan created item with no tasks as no tasks detail", () => {
    expect(
      AgentControlReplayQuery.timelineItemFromEvent(
        {
          type: "agent.plan.created",
          plan: {
            id: "plan-empty",
            objective: "Empty plan",
            approvalState: "not_required",
            tasks: [],
          },
        },
        "event-11",
      ),
    ).toMatchObject({
      kind: "plan",
      detail: "no tasks · approval not_required",
    })
  })

  test("renders safety allow-with-checkpoint as working tone", () => {
    expect(
      AgentControlReplayQuery.timelineItemFromEvent(
        {
          type: "agent.safety.decided",
          action: "allow_with_checkpoint",
          risk: "medium",
          reason: "risky_permission",
          permission: "bash",
          matchedRule: "bash",
        },
        "event-12",
      ),
    ).toMatchObject({
      kind: "safety",
      title: "Safety: Checkpoint",
      status: "allow_with_checkpoint",
      tone: "working",
      shadow: false,
    })
  })

  test("renders safety allow as success tone", () => {
    expect(
      AgentControlReplayQuery.timelineItemFromEvent(
        {
          type: "agent.safety.decided",
          action: "allow",
          risk: "safe",
          reason: "safe_permission",
          permission: "read",
        },
        "event-13",
      ),
    ).toMatchObject({
      kind: "safety",
      title: "Safety: Allow",
      tone: "success",
    })
  })

  test("completed agent event uses summary as detail when available", () => {
    expect(
      AgentControlReplayQuery.timelineItemFromEvent(
        { type: "agent.completed", validationStatus: "passed", summary: "all tasks done" },
        "event-14",
      ),
    ).toMatchObject({
      kind: "completed",
      detail: "all tasks done",
    })
  })

  test("completed phase renders as success tone", () => {
    expect(
      AgentControlReplayQuery.timelineItemFromEvent(
        { type: "agent.phase.changed", phase: "complete", reason: "ready_to_complete" },
        "event-15",
      ),
    ).toMatchObject({
      kind: "phase",
      tone: "success",
    })
  })

  test("blocked phase renders as warning tone", () => {
    expect(
      AgentControlReplayQuery.timelineItemFromEvent(
        { type: "agent.phase.changed", phase: "blocked", reason: "plan_tasks_open" },
        "event-16",
      ),
    ).toMatchObject({
      kind: "phase",
      tone: "warning",
    })
  })

  test("returns undefined for unknown or malformed events", () => {
    expect(AgentControlReplayQuery.timelineItemFromEvent({ type: "tool.executed" }, "event-x")).toBeUndefined()
    expect(AgentControlReplayQuery.timelineItemFromEvent(null, "event-y")).toBeUndefined()
    expect(AgentControlReplayQuery.timelineItemFromEvent("raw string", "event-z")).toBeUndefined()
  })

  test("plan objective truncated in timeline title when longer than 40 chars", () => {
    const longObjective = "This is a very long plan objective that exceeds the limit for display"
    const item = AgentControlReplayQuery.timelineItemFromEvent(
      {
        type: "agent.plan.created",
        plan: {
          id: "plan-long",
          objective: longObjective,
          approvalState: "not_required",
          tasks: [],
        },
      },
      "event-17",
    )
    expect(item?.title).toMatch(/^Plan: .{1,44}\.\.\.$/)
  })

  test("normalizeAgentControlEvent flattens properties into top-level fields", () => {
    const normalized = AgentControlReplayQuery.normalizeAgentControlEvent({
      type: "agent.reasoning.selected",
      properties: {
        depth: "deep",
        reason: "autonomous_mode",
      },
    })
    expect(normalized).toMatchObject({ type: "agent.reasoning.selected", depth: "deep", reason: "autonomous_mode" })
  })

  test("normalizeAgentControlEvent rejects completed event with invalid validationStatus", () => {
    expect(
      AgentControlReplayQuery.isAgentControlEvent({
        type: "agent.completed",
        validationStatus: "pending",
      }),
    ).toBe(false)
  })

  test("normalizeAgentControlEvent accepts completed event with not_required validationStatus", () => {
    expect(
      AgentControlReplayQuery.isAgentControlEvent({
        type: "agent.completed",
        validationStatus: "not_required",
      }),
    ).toBe(true)
  })
})
