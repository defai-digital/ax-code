import { describe, expect, test } from "bun:test"

import { AgentControl } from "../../src/control-plane/agent-control"

const plan: AgentControl.PlanArtifact = {
  id: "plan_01",
  objective: "Implement v5 control-plane contracts",
  evidence: ["ADR-006 selected Agent Control Plane"],
  assumptions: ["Phase 1 is shadow-mode only"],
  tasks: [
    {
      id: "task_01",
      title: "Define contracts",
      status: "completed",
      evidence: ["Schemas added"],
      validation: ["Unit coverage"],
    },
    {
      id: "task_02",
      title: "Wire runtime",
      status: "pending",
      evidence: [],
      validation: ["No behavior change before shadow events exist"],
    },
  ],
  risks: ["Changing runtime before contract stabilization would be high risk"],
  validation: ["Replay events parse"],
  approvalState: "not_required",
}

describe("AgentControl", () => {
  test("creates plan artifacts with conservative defaults", () => {
    expect(
      AgentControl.createPlan({
        id: "plan_02",
        objective: "Create typed plan state",
        tasks: [{ id: "task_01", title: "Define helper" }],
      }),
    ).toEqual({
      id: "plan_02",
      objective: "Create typed plan state",
      evidence: [],
      assumptions: [],
      tasks: [
        {
          id: "task_01",
          title: "Define helper",
          status: "pending",
          evidence: [],
          validation: [],
        },
      ],
      risks: [],
      validation: [],
      approvalState: "not_required",
    })
  })

  test("creates shadow plan artifacts from plan mode objectives", () => {
    expect(
      AgentControl.createShadowPlan({
        id: "plan_shadow",
        objective: "  Review the autonomous planner   and prepare a v5 path  ",
        ownerAgent: "plan",
        reason: "plan_mode",
      }),
    ).toMatchObject({
      id: "plan_shadow",
      objective: "Review the autonomous planner and prepare a v5 path",
      evidence: ["Shadow plan initialized from plan_mode."],
      assumptions: ["The plan artifact is session-local and must be refined before tool-heavy implementation."],
      tasks: [
        {
          id: "plan_shadow_task_01",
          title: "Assess objective and produce an implementation plan",
          status: "pending",
          ownerAgent: "plan",
        },
      ],
    })
  })

  test("uses a safe objective for empty shadow plans", () => {
    expect(
      AgentControl.createShadowPlan({
        id: "plan_empty",
        objective: "",
        reason: "plan_mode",
      }).objective,
    ).toBe("Plan the requested work")
  })


  test("creates default shadow-mode state", () => {
    expect(
      AgentControl.createState({
        sessionID: "ses_123",
        objective: "Review v5 planning architecture",
      }),
    ).toEqual({
      sessionID: "ses_123",
      phase: "assess",
      objective: "Review v5 planning architecture",
      reasoningDepth: "standard",
      lastDecisionReason: "session_started",
      validationStatus: "not_required",
    })
  })

  test("allows valid phase transitions and preserves plan state", () => {
    const state = AgentControl.createState({
      sessionID: "ses_123",
      objective: plan.objective,
      plan,
    })

    expect(
      AgentControl.transition({
        state,
        phase: "plan",
        reason: "complex_task_requires_plan",
        reasoningDepth: "deep",
        validationStatus: "pending",
      }),
    ).toMatchObject({
      phase: "plan",
      plan,
      reasoningDepth: "deep",
      lastDecisionReason: "complex_task_requires_plan",
      validationStatus: "pending",
    })
  })

  test("rejects invalid completion without validation path", () => {
    const state = AgentControl.createState({
      sessionID: "ses_123",
      objective: plan.objective,
    })

    expect(() =>
      AgentControl.transition({
        state,
        phase: "complete",
        reason: "cannot_skip_to_complete",
      }),
    ).toThrow("invalid agent phase transition")
  })

  test("summarizes plan progress", () => {
    expect(AgentControl.planProgress(plan)).toEqual({
      total: 2,
      completed: 1,
      blocked: 0,
      cancelled: 0,
      open: 1,
    })
  })

  test("rejects completion when plan tasks are still open", () => {
    const state = AgentControl.createState({
      sessionID: "ses_123",
      objective: plan.objective,
      phase: "summarize",
      plan,
      validationStatus: "passed",
    })

    expect(() =>
      AgentControl.transition({
        state,
        phase: "complete",
        reason: "plan_not_finished",
      }),
    ).toThrow("cannot complete with open or blocked plan tasks")
  })

  test("allows completion after plan tasks are closed and validation passed", () => {
    const closedPlan: AgentControl.PlanArtifact = {
      ...plan,
      tasks: plan.tasks.map((task) => ({ ...task, status: "completed" })),
    }
    const state = AgentControl.createState({
      sessionID: "ses_123",
      objective: plan.objective,
      phase: "summarize",
      plan: closedPlan,
      validationStatus: "passed",
    })

    expect(
      AgentControl.transition({
        state,
        phase: "complete",
        reason: "all_tasks_closed",
      }),
    ).toMatchObject({
      phase: "complete",
      validationStatus: "passed",
    })
  })

  test("rejects creating already completed invalid state", () => {
    expect(() =>
      AgentControl.createState({
        sessionID: "ses_123",
        objective: plan.objective,
        phase: "complete",
        plan,
        validationStatus: "passed",
      }),
    ).toThrow("cannot complete with open or blocked plan tasks")
  })

  test("updates task status by id", () => {
    expect(AgentControl.updateTaskStatus(plan, "task_02", "completed").tasks[1].status).toBe("completed")
  })

  test("rejects updating unknown plan tasks", () => {
    expect(() => AgentControl.updateTaskStatus(plan, "missing", "completed")).toThrow("plan task not found")
  })

  test("applies checkpoint updates without duplicating plan evidence", () => {
    const updated = AgentControl.applyCheckpoint(plan, {
      reason: "model_checkpoint",
      evidence: ["ADR-006 selected Agent Control Plane", "Replay events parse"],
      assumptions: ["Runtime wiring remains shadow-mode"],
      risks: ["Plan update parsing must stay conservative"],
      validation: ["Activity history renders plan progress"],
      taskUpdates: [
        {
          id: "task_02",
          status: "completed",
          evidence: ["Plan update helper added"],
          validation: ["Task status can be updated by checkpoint"],
        },
      ],
    })

    expect(updated.evidence).toEqual([
      "ADR-006 selected Agent Control Plane",
      "Checkpoint: model_checkpoint",
      "Replay events parse",
    ])
    expect(updated.assumptions).toEqual(["Phase 1 is shadow-mode only", "Runtime wiring remains shadow-mode"])
    expect(updated.tasks[1]).toMatchObject({
      id: "task_02",
      status: "completed",
      evidence: ["Plan update helper added"],
      validation: ["No behavior change before shadow events exist", "Task status can be updated by checkpoint"],
    })
    expect(updated.risks).toContain("Plan update parsing must stay conservative")
    expect(updated.validation).toContain("Activity history renders plan progress")
  })

  test("rejects checkpoint updates for unknown tasks", () => {
    expect(() =>
      AgentControl.applyCheckpoint(plan, {
        reason: "bad_checkpoint",
        taskUpdates: [{ id: "missing", status: "completed" }],
      }),
    ).toThrow("plan task not found")
  })
})
