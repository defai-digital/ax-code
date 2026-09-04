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

  test("rejects a rendered plan over the read cap with an actionable error", async () => {
    const tool = await SubmitGoalPlanTool.init()
    const params = {
      kind: "code-change" as const,
      title: "A very verbose plan",
      acceptance: Array.from({ length: 5 }, (_, index) => `Criterion ${index}: ${"outcome ".repeat(120)}`),
      verification: Array.from({ length: 8 }, (_, index) => ({
        tag: "gating" as const,
        action: `Step ${index}: ${"run the verification suite and inspect ".repeat(60)}`,
        observation: `Observation ${index}: ${"all checks pass and the output shows ".repeat(60)}`,
      })),
      nonGoals: ["unrelated refactors"],
      assumedScope: "src",
      implementationApproach: "Approach: ".concat("describe the work in detail ".repeat(200)),
      taskChecklist: Array.from(
        { length: 8 },
        (_, index) => `Task ${index}: ${"perform the implementation step ".repeat(60)}`,
      ),
    }
    const ctx = {
      sessionID: "ses_test" as any,
      messageID: MessageID.ascending(),
      agent: "goal-plan-writer",
      abort: new AbortController().signal,
      messages: [],
      extra: {},
      metadata() {},
      async ask() {},
    }
    await expect(tool.execute(params, ctx)).rejects.toThrow(
      new RegExp(`exceeding the ${GoalPlan.MAX_READ_BYTES}-byte limit`),
    )
  })

  test("accepts a plan just under the read cap", async () => {
    const tool = await SubmitGoalPlanTool.init()
    const result = await tool.execute(
      {
        kind: "code-change",
        title: "A large but compact plan",
        acceptance: ["The feature works end to end"],
        verification: [{ tag: "gating", action: "run the test suite", observation: "all checks pass" }],
        nonGoals: ["unrelated refactors"],
        assumedScope: "src",
        implementationApproach: "Details: ".concat("step ".repeat(900)),
        taskChecklist: ["Implement", "Verify"],
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
    expect(Buffer.byteLength(result.output, "utf8")).toBeLessThanOrEqual(GoalPlan.MAX_READ_BYTES)
    expect(() => GoalPlan.parse(result.output)).not.toThrow()
  })

  test("opts out of generic output truncation so the persisted plan stays intact", async () => {
    // A plan of many tiny single-character non-goals can stay under the byte
    // cap while exceeding the generic 2000-line truncation threshold. Without
    // the bypass, the tool part stored for the orchestrator would lose its
    // tail sections and GoalPlan.write would fail (or freeze a truncated
    // contract) only after the writer session has stopped.
    const tool = await SubmitGoalPlanTool.init()
    const result = await tool.execute(
      {
        kind: "code-change",
        title: "x",
        acceptance: ["a"],
        verification: [{ tag: "gating", action: "a", observation: "a" }],
        nonGoals: Array.from({ length: 1985 }, () => "a"),
        assumedScope: "a",
        implementationApproach: "a",
        taskChecklist: ["a", "b"],
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
    const { Truncate } = await import("../../src/tool/truncate")
    expect(Buffer.byteLength(result.output, "utf8")).toBeLessThanOrEqual(GoalPlan.MAX_READ_BYTES)
    expect(result.output.split("\n").length).toBeGreaterThan(Truncate.MAX_LINES)
    expect(result.metadata.truncated).toBe(false)
    expect(result.output).toContain("## Task checklist")
    expect(() => GoalPlan.parse(result.output)).not.toThrow()
  })
})
