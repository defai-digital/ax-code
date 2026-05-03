import { describe, expect, test } from "bun:test"

import { AgentControl } from "../../src/control-plane/agent-control"
import { AgentControlEvents } from "../../src/control-plane/agent-control-events"
import { AgentControlSummary } from "../../src/control-plane/agent-control-summary"

const plan = AgentControl.createPlan({
  id: "plan_01",
  objective: "Summarize control-plane replay events",
  tasks: [
    { id: "task_01", title: "Create summary helper", status: "completed" },
    { id: "task_02", title: "Wire UI", status: "pending" },
  ],
})

describe("AgentControlSummary", () => {
  test("summarizes latest control-plane state from replay events", () => {
    const summary = AgentControlSummary.fromEvents([
      AgentControlEvents.phaseChanged({
        sessionID: "ses_123",
        phase: "plan",
        reason: "plan_mode",
      }),
      AgentControlEvents.reasoningSelected({
        sessionID: "ses_123",
        depth: "deep",
        reason: "planning_risk_signal",
        checkpoint: true,
      }),
      AgentControlEvents.planCreated({
        sessionID: "ses_123",
        plan,
      }),
      AgentControlEvents.safetyDecided({
        sessionID: "ses_123",
        action: "ask",
        risk: "high",
        reason: "autonomous_risky_permission",
        permission: "write",
        checkpointRequired: true,
        shadow: true,
      }),
      AgentControlEvents.validationUpdated({
        sessionID: "ses_123",
        status: "pending",
      }),
    ])

    expect(summary).toMatchObject({
      phase: "plan",
      phaseReason: "plan_mode",
      reasoningDepth: "deep",
      reasoningReason: "planning_risk_signal",
      plan: {
        id: "plan_01",
        objective: "Summarize control-plane replay events",
        approvalState: "not_required",
        progress: {
          total: 2,
          completed: 1,
          open: 1,
        },
      },
      validationStatus: "pending",
      safety: {
        shadow: 1,
        ask: 1,
      },
    })
  })

  test("completed events override phase and validation status", () => {
    const summary = AgentControlSummary.fromEvents([
      AgentControlEvents.phaseChanged({
        sessionID: "ses_123",
        phase: "validate",
        reason: "validation_required",
      }),
      AgentControlEvents.completed({
        sessionID: "ses_123",
        validationStatus: "passed",
      }),
    ])

    expect(summary).toMatchObject({
      phase: "complete",
      validationStatus: "passed",
      completed: true,
    })
  })

  test("summarizes completion gate decisions", () => {
    const blocked = AgentControlSummary.fromEvents([
      AgentControlEvents.completionGateDecided({
        sessionID: "ses_123",
        status: "blocked",
        reason: "empty_subagent_result",
        message: "Subagent returned no usable final response.",
      }),
    ])

    expect(blocked).toMatchObject({
      phase: "blocked",
      blockedReason: "empty_subagent_result",
      completionGate: {
        status: "blocked",
        reason: "empty_subagent_result",
      },
    })

    const allowed = AgentControlSummary.fromEvents([
      AgentControlEvents.completionGateDecided({
        sessionID: "ses_123",
        status: "allow",
        reason: "none",
      }),
    ])

    expect(allowed.completionGate).toMatchObject({ status: "allow", reason: "none" })
  })

  test("renders compact status lines", () => {
    expect(
      AgentControlSummary.statusLine(
        AgentControlSummary.fromEvents([
          AgentControlEvents.phaseChanged({
            sessionID: "ses_123",
            phase: "plan",
            reason: "plan_mode",
          }),
          AgentControlEvents.planCreated({
            sessionID: "ses_123",
            plan,
          }),
        ]),
      ),
    ).toBe("phase plan · plan 1/2")
  })
})
