import z from "zod"
import { GoalPlan } from "@/session/goal-plan"
import { Tool } from "./tool"
import DESCRIPTION from "./submit_goal_plan.txt"

const Kind = z.enum(GoalPlan.Kind)

export const SubmitGoalPlanTool = Tool.define("submit_goal_plan", {
  description: DESCRIPTION,
  parameters: z.object({
    kind: Kind.describe("code-change, analysis, or research."),
    title: z.string().optional().describe("One-sentence plan headline."),
    acceptance: z
      .array(z.string().min(1))
      .min(1)
      .max(GoalPlan.MAX_ACCEPTANCE)
      .describe("Observable outcome criteria derived from the objective."),
    verification: z
      .array(
        z.object({
          tag: z.enum(["gating", "evidence"]).describe("gating decides pass/fail; evidence is corroboration."),
          action: z.string().min(1).describe("What to run or inspect."),
          observation: z.string().min(1).describe("What must be present to pass."),
        }),
      )
      .min(1)
      .describe("Shared procedure covering every acceptance criterion."),
    nonGoals: z.array(z.string().min(1)).min(1).describe("Items a reader might assume in scope but are not."),
    assumedScope: z.string().min(1).describe("Files, modules, or deps this goal is expected to touch."),
    implementationApproach: z
      .string()
      .optional()
      .describe("code-change only. How to structure the work so it is testable. Not a completion gate."),
    taskChecklist: z
      .array(z.string().min(1))
      .min(GoalPlan.MIN_CHECKLIST)
      .max(GoalPlan.MAX_CHECKLIST)
      .optional()
      .describe("code-change only. Ordered implementation steps. Not a completion gate."),
    risks: z.array(z.string().min(1)).optional().describe("Internal contradictions or environment limits."),
  }),
  async execute(params) {
    const contract = GoalPlan.fromFields({
      kind: params.kind,
      title: params.title,
      acceptance: params.acceptance.map((text) => ({ text })),
      verification: params.verification,
      nonGoals: params.nonGoals,
      assumedScope: params.assumedScope,
      implementationApproach: params.implementationApproach,
      taskChecklist: params.taskChecklist,
      risks: params.risks,
    })
    const markdown = GoalPlan.render(contract)
    return {
      title: `Submitted ${contract.kind} goal plan`,
      output: markdown,
      metadata: {
        kind: contract.kind,
        acceptanceIds: contract.acceptance.map((item) => item.id),
      },
    }
  },
})
