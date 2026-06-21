import z from "zod"
import { Session } from "@/session"
import { SessionGoal } from "@/session/goal"
import { GoalVerification } from "@/session/goal-verification"
import { Todo } from "@/session/todo"
import { Tool } from "./tool"
import { ToolNumber } from "./schema"

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
    tokenBudget: ToolNumber(z.number().int().positive())
      .optional()
      .describe("Optional positive token budget for the new goal."),
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
    "Update the existing goal. Use this tool only to mark the goal achieved or genuinely blocked. Set status to complete only when the objective has actually been achieved and no required work remains; completion is verified — it is rejected while todos are pending, and if files were modified you must run a verification command (tests/build) after the last change before completing. Set status to blocked only when the same blocking condition has repeated and meaningful progress cannot continue without user input or an external-state change. You cannot use this tool to pause, resume, budget-limit, usage-limit, or clear a goal.",
  parameters: z.object({
    status: z.enum(["complete", "blocked"]),
  }),
  async execute(params, ctx) {
    if (params.status === "complete") {
      // Evidence gate: the goal continuation prompt alone does not stop a
      // model from declaring success early (observed in the field — a goal
      // to "implement, test, and commit" was marked complete after edits
      // with no verification run). Throwing a regular Error surfaces the
      // requirement to the model so it can recover by finishing todos or
      // running its tests, then calling update_goal again.
      const decision = GoalVerification.decide({
        messages: await Session.messages({ sessionID: ctx.sessionID }),
        pendingTodos: Todo.active(ctx.sessionID),
      })
      if (!decision.ok) throw new Error(decision.message)
    }
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
