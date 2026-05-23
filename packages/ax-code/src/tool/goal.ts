import z from "zod"
import { SessionGoal } from "@/session/goal"
import { Tool } from "./tool"

function goalOutput(goal: SessionGoal.Info | undefined) {
  return JSON.stringify(
    {
      goal: SessionGoal.publicInfo(goal),
    },
    null,
    2,
  )
}

export const GetGoalTool = Tool.define("get_goal", {
  description:
    "Get the current goal for this session, including status, budgets, token and elapsed-time usage, and remaining token budget.",
  parameters: z.object({}),
  async execute(_params, ctx) {
    const goal = await SessionGoal.get(ctx.sessionID)
    return {
      title: "Current goal",
      output: goalOutput(goal),
      metadata: {
        goal: SessionGoal.publicInfo(goal),
      },
    }
  },
})

export const CreateGoalTool = Tool.define("create_goal", {
  description:
    "Create a goal only when explicitly requested by the user or system/developer instructions; do not infer goals from ordinary tasks. Set tokenBudget only when an explicit token budget is requested. Fails if an active goal already exists.",
  parameters: z.object({
    objective: z.string().min(1).describe("The concrete objective to start pursuing."),
    tokenBudget: z.number().int().positive().optional().describe("Optional positive token budget for the new goal."),
  }),
  async execute(params, ctx) {
    const goal = await SessionGoal.create({
      sessionID: ctx.sessionID,
      objective: params.objective,
      tokenBudget: params.tokenBudget,
      replace: false,
    })
    return {
      title: "Created goal",
      output: goalOutput(goal),
      metadata: {
        goal: SessionGoal.publicInfo(goal),
      },
    }
  },
})

export const UpdateGoalTool = Tool.define("update_goal", {
  description:
    "Update the existing goal. Use this tool only to mark the goal achieved or genuinely blocked. Set status to complete only when the objective has actually been achieved and no required work remains. Set status to blocked only when the same blocking condition has repeated and meaningful progress cannot continue without user input or an external-state change. You cannot use this tool to pause, resume, budget-limit, usage-limit, or clear a goal.",
  parameters: z.object({
    status: z.enum(["complete", "blocked"]),
  }),
  async execute(params, ctx) {
    const goal = await SessionGoal.setStatus({
      sessionID: ctx.sessionID,
      status: params.status,
    })
    const completionBudgetReport =
      params.status === "complete" && (goal.tokenBudget !== undefined || goal.timeUsedSeconds > 0)
        ? "Goal achieved. Report final token/time usage from this tool result in your final response."
        : undefined
    return {
      title: params.status === "complete" ? "Completed goal" : "Blocked goal",
      output: JSON.stringify(
        {
          goal: SessionGoal.publicInfo(goal),
          completionBudgetReport,
        },
        null,
        2,
      ),
      metadata: {
        goal: SessionGoal.publicInfo(goal),
        completionBudgetReport,
      },
    }
  },
})
