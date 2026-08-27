import { describe, expect, test } from "vitest"
import { SubmitGoalPlanTool } from "../../src/tool/submit_goal_plan"
import { GoalPlan } from "../../src/session/goal-plan"
import { MessageID } from "../../src/session/schema"

describe("submit_goal_plan", () => {
  test("renders a canonical contract", async () => {
    const tool = await SubmitGoalPlanTool.init()
    const result = await tool.execute(
      {
        kind: "code-change",
        title: "Add health endpoint",
        acceptance: ["GET /health returns 200"],
        verification: [{ tag: "gating", action: "curl the endpoint", observation: "HTTP 200" }],
        nonGoals: ["metrics"],
        assumedScope: "src/server",
        implementationApproach: "Add a route next to the existing ping handler.",
        taskChecklist: ["Find the router", "Add the route", "Verify"],
      },
      {
        sessionID: "ses_test" as any,
        messageID: MessageID.ascending(),
        agent: "goal-plan-writer",
        abort: new AbortController().signal,
        messages: [],
        extra: {},
        metadata() {},
        async ask() {},
      },
    )
    const parsed = GoalPlan.parse(result.output)
    expect(parsed.kind).toBe("code-change")
    expect(parsed.acceptance[0]?.id).toBe("AC1")
    expect(parsed.acceptance[0]?.text).toContain("GET /health")
  })
})
