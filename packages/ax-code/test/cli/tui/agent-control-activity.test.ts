import { describe, expect, test } from "bun:test"
import { agentControlActivityItems } from "@/cli/cmd/tui/routes/session/agent-control-activity"

describe("agentControlActivityItems", () => {
  test("maps agent-control replay rows into TUI activity items", () => {
    expect(
      agentControlActivityItems([
        {
          event_data: {
            type: "agent.plan.updated",
            plan: {
              id: "plan-1",
              objective: "Coordinate v5 agent-control work",
              approvalState: "approved",
              tasks: [{ status: "completed" }, { status: "blocked" }],
            },
          },
          time_created: 42,
        },
      ]),
    ).toEqual([
      {
        id: "agent-control:42:0",
        icon: "\u25C6",
        label: "Plan: Coordinate v5 agent-control work",
        status: "approved",
        tool: "agent.plan",
        time: 42,
        description: "1/2 tasks completed \u00B7 1 blocked \u00B7 approval approved",
        category: "agent-control",
      },
    ])
  })

  test("ignores non-agent-control replay rows", () => {
    expect(
      agentControlActivityItems([
        {
          event_data: {
            type: "message.updated",
          },
          time_created: 42,
        },
      ]),
    ).toEqual([])
  })
})
