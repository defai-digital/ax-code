import { describe, expect, test } from "bun:test"

import { AgentControl } from "../../src/control-plane/agent-control"
import { AgentControlEvents } from "../../src/control-plane/agent-control-events"
import { ReplayEvent } from "../../src/replay/event"

const plan = AgentControl.createPlan({
  id: "plan_01",
  objective: "Introduce v5 control-plane event factories",
  tasks: [{ id: "task_01", title: "Define factories", status: "completed" }],
})

describe("AgentControlEvents", () => {
  test("creates replay-parseable phase and reasoning events", () => {
    const event = AgentControlEvents.phaseChanged({
      sessionID: "ses_123",
      previousPhase: "assess",
      phase: "plan",
      reason: "plan_mode",
      deterministic: false,
    })
    expect("messageID" in event).toBe(false)
    expect(
      ReplayEvent.parse(event),
    ).toMatchObject({
      type: "agent.phase.changed",
      previousPhase: "assess",
      phase: "plan",
      deterministic: false,
    })

    expect(
      ReplayEvent.parse(
        AgentControlEvents.reasoningSelected({
          sessionID: "ses_123",
          depth: "deep",
          reason: "planning_risk_signal",
          policyVersion: "v4-bridge",
          checkpoint: true,
        }),
      ),
    ).toMatchObject({
      type: "agent.reasoning.selected",
      depth: "deep",
      checkpoint: true,
    })
  })

  test("creates replay-parseable plan and validation events", () => {
    expect(
      ReplayEvent.parse(
        AgentControlEvents.planCreated({
          sessionID: "ses_123",
          plan,
        }),
      ),
    ).toMatchObject({
      type: "agent.plan.created",
      plan: { id: "plan_01" },
    })

    expect(
      ReplayEvent.parse(
        AgentControlEvents.planUpdated({
          sessionID: "ses_123",
          plan,
          reason: "checkpoint",
        }),
      ),
    ).toMatchObject({
      type: "agent.plan.updated",
      reason: "checkpoint",
    })

    expect(
      ReplayEvent.parse(
        AgentControlEvents.validationUpdated({
          sessionID: "ses_123",
          status: "passed",
          reason: "contract_tests",
        }),
      ),
    ).toMatchObject({
      type: "agent.validation.updated",
      status: "passed",
    })
  })

  test("creates replay-parseable blocked and completed events", () => {
    expect(
      ReplayEvent.parse(
        AgentControlEvents.blocked({
          sessionID: "ses_123",
          phase: "execute",
          reason: "approval_required",
          recoverable: true,
        }),
      ),
    ).toMatchObject({
      type: "agent.blocked",
      recoverable: true,
    })

    expect(
      ReplayEvent.parse(
        AgentControlEvents.completed({
          sessionID: "ses_123",
          validationStatus: "passed",
          summary: "control-plane event factories ready",
        }),
      ),
    ).toMatchObject({
      type: "agent.completed",
      phase: "complete",
      validationStatus: "passed",
    })

    expect(
      ReplayEvent.parse(
        AgentControlEvents.completionGateDecided({
          sessionID: "ses_123",
          status: "blocked",
          reason: "empty_subagent_result",
          message: "Subagent returned no usable final response.",
          retryCount: 1,
          maxRetries: 2,
        }),
      ),
    ).toMatchObject({
      type: "agent.completion_gate.decided",
      status: "blocked",
      reason: "empty_subagent_result",
      retryCount: 1,
      maxRetries: 2,
    })
  })

  test("creates replay-parseable safety decision events", () => {
    expect(
      ReplayEvent.parse(
        AgentControlEvents.safetyDecided({
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
      ),
    ).toMatchObject({
      type: "agent.safety.decided",
      action: "ask",
      risk: "high",
      permission: "write",
      checkpointRequired: true,
      shadow: true,
    })
  })
})
