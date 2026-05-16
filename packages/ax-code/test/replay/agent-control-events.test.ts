import { describe, expect, test } from "bun:test"

import { ReplayEvent } from "../../src/replay/event"

const plan = {
  id: "plan_01",
  objective: "Introduce v5 Agent Control Plane",
  evidence: ["ADR-006"],
  assumptions: ["Phase 1 is shadow-mode"],
  tasks: [
    {
      id: "task_01",
      title: "Define event schema",
      status: "completed",
      evidence: ["ReplayEvent accepts agent.plan.created"],
      validation: ["Schema parse succeeds"],
    },
  ],
  risks: ["Runtime wiring before shadow mode would increase migration risk"],
  validation: ["Replay event parse"],
  approvalState: "not_required",
}

describe("agent control replay events", () => {
  test("parses phase and reasoning events", () => {
    expect(
      ReplayEvent.parse({
        type: "agent.phase.changed",
        sessionID: "ses_123",
        previousPhase: "assess",
        phase: "plan",
        reason: "complex_task_requires_plan",
      }),
    ).toMatchObject({
      type: "agent.phase.changed",
      phase: "plan",
    })

    expect(
      ReplayEvent.parse({
        type: "agent.reasoning.selected",
        sessionID: "ses_123",
        depth: "deep",
        reason: "planning_risk_signal",
        checkpoint: true,
      }),
    ).toMatchObject({
      type: "agent.reasoning.selected",
      depth: "deep",
      checkpoint: true,
    })
  })

  test("parses plan, validation, blocked, and completed events", () => {
    expect(
      ReplayEvent.parse({
        type: "agent.plan.created",
        sessionID: "ses_123",
        plan,
      }),
    ).toMatchObject({
      type: "agent.plan.created",
      plan: { objective: "Introduce v5 Agent Control Plane" },
    })

    expect(
      ReplayEvent.parse({
        type: "agent.validation.updated",
        sessionID: "ses_123",
        status: "passed",
        reason: "contract_tests_defined",
      }),
    ).toMatchObject({
      type: "agent.validation.updated",
      status: "passed",
    })

    expect(
      ReplayEvent.parse({
        type: "agent.blocked",
        sessionID: "ses_123",
        phase: "execute",
        reason: "approval_required",
        recoverable: true,
      }),
    ).toMatchObject({
      type: "agent.blocked",
      recoverable: true,
    })

    expect(
      ReplayEvent.parse({
        type: "agent.completed",
        sessionID: "ses_123",
        phase: "complete",
        validationStatus: "passed",
        summary: "Control-plane contract slice completed",
      }),
    ).toMatchObject({
      type: "agent.completed",
      validationStatus: "passed",
    })
  })

  test("rejects invalid control-plane phase values", () => {
    expect(
      ReplayEvent.safeParse({
        type: "agent.phase.changed",
        sessionID: "ses_123",
        phase: "done",
        reason: "invalid",
      }).success,
    ).toBe(false)
  })

  test("requires completed events to use the complete phase", () => {
    expect(
      ReplayEvent.safeParse({
        type: "agent.completed",
        sessionID: "ses_123",
        phase: "execute",
        validationStatus: "passed",
      }).success,
    ).toBe(false)
  })

  test("rejects completed events with failed validation", () => {
    expect(
      ReplayEvent.safeParse({
        type: "agent.completed",
        sessionID: "ses_123",
        phase: "complete",
        validationStatus: "failed",
      }).success,
    ).toBe(false)
  })

  test("parses safety decision events", () => {
    expect(
      ReplayEvent.parse({
        type: "agent.safety.decided",
        sessionID: "ses_123",
        action: "ask",
        risk: "high",
        reason: "autonomous_risky_permission",
        permission: "write",
        tool: "write",
        path: "src/app.ts",
        checkpointRequired: true,
        matchedRule: "write",
        shadow: true,
      }),
    ).toMatchObject({
      type: "agent.safety.decided",
      action: "ask",
      risk: "high",
      permission: "write",
      shadow: true,
    })
  })
})
