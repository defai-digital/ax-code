import { goalSourceScope } from "@/session/goal-source-scope"
import z from "zod"
import { Session } from "@/session"
import { SessionGoal } from "@/session/goal"
import { GoalContractVerification } from "@/session/goal-contract-verification"
import { GoalPlanOrchestration } from "@/session/goal-plan-orchestration"
import { GoalVerification } from "@/session/goal-verification"
import { goalBlockerEvidence } from "@/session/goal-blocker"
import { goalCheckpoint } from "@/session/goal-checkpoint"
import { GoalPlan } from "@/session/goal-plan"
import { currentSourceState } from "@/quality/source-state"
import { Instance } from "@/project/instance"
import { Todo } from "@/session/todo"
import { Tool } from "./tool"
import { ModelID, ProviderID } from "@/provider/schema"
import { lastModel } from "@/session/prompt/prompt-command-selection"
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
    const messages = goal ? await Session.messages({ sessionID: ctx.sessionID }) : []
    const availableEvidence = goal ? goalBlockerEvidence(messages, goal.time.created) : []
    const evidence = [
      ...availableEvidence.filter((item) => item.kind === "user"),
      ...availableEvidence.filter((item) => item.kind === "tool").slice(-11),
    ]
    const checkpoint = goal ? await goalCheckpoint(goal, messages) : undefined
    const blocker = messages
      .flatMap((m) => m.parts)
      .filter((p) => p.type === "tool" && p.tool === "update_goal" && p.state.status === "completed")
      .flatMap((p) =>
        p.type === "tool" &&
        p.state.status === "completed" &&
        p.state.metadata?.goal?.time?.created === goal?.time.created &&
        p.state.metadata?.blocker
          ? [p.state.metadata.blocker]
          : [],
      )
      .at(-1)
    return {
      title: "Current goal",
      output: JSON.stringify(
        {
          goal: SessionGoal.publicInfo(goal),
          checkpoint,
          evidence,
          ...(goal?.status === "blocked" && blocker ? { blocker } : {}),
        },
        null,
        2,
      ),
      metadata: {
        goal: SessionGoal.publicInfo(goal),
      },
    }
  },
})

export const CreateGoalTool = Tool.define("create_goal", {
  description:
    "Create a goal only when explicitly requested by the user or system/developer instructions; do not infer goals from ordinary tasks. The goal starts immediately without an assurance contract unless you pass assure, which first freezes acceptance criteria and executable checks and makes completion require their receipts; set assure when the user asked for provable completion, not by default. Set tokenBudget only when an explicit token budget is requested, and timeBudgetSeconds only when an explicit wall-clock limit is requested. Fails while an active or paused goal exists; only completed, blocked, or budget-limited goals are replaced.",
  parameters: z.object({
    objective: z.string().min(1).describe("The concrete objective to start pursuing."),
    tokenBudget: ToolNumber(z.number().int().positive())
      .optional()
      .describe("Optional positive token budget for the new goal."),
    timeBudgetSeconds: ToolNumber(z.number().int().positive())
      .optional()
      .describe("Optional positive wall-clock budget for the new goal, in seconds."),
    assure: z
      .boolean()
      .optional()
      .describe(
        "Run the plan writer before starting, so the goal carries frozen acceptance criteria and executable checks and cannot complete without their receipts. Omit unless the user asked for provable completion.",
      ),
  }),
  async execute(params, ctx) {
    const selected = ctx.extra?.model
    const model =
      selected?.providerID && selected?.id
        ? { providerID: ProviderID.make(selected.providerID), modelID: ModelID.make(selected.id) }
        : await lastModel(ctx.sessionID)
    const lastUser = ctx.messages.findLast((m) => m.info.role === "user")?.info
    const variant =
      lastUser?.role === "user" &&
      lastUser.model.providerID === model.providerID &&
      lastUser.model.modelID === model.modelID
        ? lastUser.variant
        : undefined
    ctx.abort.throwIfAborted()
    // Assurance is opt-in, matching /goal (item 2, option A): a plain create starts
    // immediately with no contract, and SessionGoal.format reports that state.
    const prepared = params.assure
      ? await GoalPlanOrchestration.activate({
          sessionID: ctx.sessionID,
          objective: params.objective,
          tokenBudget: params.tokenBudget,
          timeBudgetSeconds: params.timeBudgetSeconds,
          replace: false,
          model,
          variant,
          abort: ctx.abort,
        })
      : await (async () => {
          const goal = await SessionGoal.create({
            sessionID: ctx.sessionID,
            objective: params.objective,
            tokenBudget: params.tokenBudget,
            timeBudgetSeconds: params.timeBudgetSeconds,
            status: "active",
          })
          // Record the intent so resume does not silently upgrade this goal to a
          // frozen contract it never asked for.
          GoalPlan.markUnassured(ctx.sessionID, goal.time.created)
          return { goal }
        })()
    ctx.onGoalCreated?.(prepared.goal.time.created)
    return {
      title: "Created goal",
      output: goalOutput(prepared.goal),
      metadata: {
        goal: SessionGoal.publicInfo(prepared.goal),
        // Absent for an unassured create: there is no plan to point at.
        planPath: "path" in prepared ? prepared.path : undefined,
      },
    }
  },
})

export const UpdateGoalTool = Tool.define("update_goal", {
  description:
    "Update the existing goal. Use this tool only to mark the goal achieved or genuinely blocked. Set status to complete only when the objective has actually been achieved and no required work remains; completion is verified — it is rejected while todos are pending, and if files were modified you must run a verification command (tests/build) after the last change before completing. When a goal plan exists, pass acceptanceEvidence for every AC id. Set status to blocked only when the same blocking condition has repeated and meaningful progress cannot continue without user input or an external-state change. You cannot use this tool to pause, resume, budget-limit, usage-limit, or clear a goal.",
  parameters: z.object({
    status: z.enum(["complete", "blocked"]),
    blocker: z
      .object({
        kind: z.enum(["external_dependency", "authorization", "user_input"]),
        reason: z.string().trim().min(1).max(1000),
        requiredChange: z.string().trim().min(1).max(1000),
        evidence: z.array(z.string().min(1)).min(1).max(8),
        independentWorkRemaining: z.literal(false),
      })
      .optional()
      .describe(
        "Required for blocked: reason, required external/user change, original tool part or user message IDs as evidence (get_goal lists recent tool evidence IDs), and independentWorkRemaining=false. Use actual IDs from the session; do not invent attempts. Internal uncertainty or failing implementation checks call for recovery, not an external blocker.",
      ),
    acceptanceEvidence: z
      .record(z.string(), z.string())
      .optional()
      .describe("Required when a goal plan exists: map each acceptance id (AC1, AC2, …) to a short evidence string."),
  }),
  async execute(params, ctx) {
    const currentGoal = await SessionGoal.get(ctx.sessionID)
    if (!currentGoal) throw new Error("No goal is set for this session")
    if (ctx.goalBinding && ctx.goalBinding.created !== currentGoal.time.created) {
      throw new Error("This tool call belongs to a different goal. Resume the current goal before updating its status.")
    }
    if (currentGoal.status !== "active" && !(params.status === "complete" && currentGoal.status === "budget_limited"))
      throw new Error("The goal is not active. Respect the user pause or terminal state; resume before updating it.")
    const expected = { created: currentGoal.time.created, status: currentGoal.status }
    const messages = await Session.messages({ sessionID: ctx.sessionID })
    if (params.status === "blocked") {
      if (!params.blocker)
        throw new Error(
          "Blocking requires a reason, required external change and original evidence IDs. Continue independent work when possible.",
        )
      const evidence = new Set(
        goalBlockerEvidence(messages, currentGoal.time.created)
          .filter((item) => params.blocker!.kind === "user_input" || item.kind === "tool")
          .map((item) => item.id),
      )
      if (params.blocker.evidence.some((id) => !evidence.has(id)))
        throw new Error(
          "Blocker evidence must reference original tool results from the current goal or the latest genuine user message.",
        )
    }
    if (params.status === "complete") {
      // Evidence gate: the goal continuation prompt alone does not stop a
      // model from declaring success early (observed in the field — a goal
      // to "implement, test, and commit" was marked complete after edits
      // with no verification run). Throwing a regular Error surfaces the
      // requirement to the model so it can recover by finishing todos or
      // running its tests, then calling update_goal again.
      // The scan is scoped to messages created after the goal so that edits
      // from earlier goal-less conversation (or history inherited by a fork)
      // cannot block a goal that never modified a file.
      if (currentGoal) {
        const plan = GoalPlan.read(ctx.sessionID, currentGoal.time.created)
        const assurance = plan.status === "found" ? plan.contract.assurance : undefined
        const contract = GoalContractVerification.decide({
          sessionID: ctx.sessionID,
          created: currentGoal.time.created,
          acceptanceEvidence: params.acceptanceEvidence,
          ...(assurance
            ? {
                execution: {
                  messages,
                  source: await currentSourceState(
                    Instance.worktree,
                    Instance.project.vcs ?? "",
                    goalSourceScope({
                      cwd: Instance.worktree,
                      created: currentGoal.time.created,
                      sourcePaths: assurance.sourcePaths,
                      messages,
                    }).paths,
                  ),
                  cwd: Instance.worktree,
                },
              }
            : {}),
        })
        if (!contract.ok) throw new Error(contract.message)
      }
      const decision = GoalVerification.decide({
        messages,
        pendingTodos: Todo.active(ctx.sessionID),
        since: currentGoal?.time.created,
      })
      if (!decision.ok) throw new Error(decision.message)
    }
    ctx.abort.throwIfAborted()
    const goal = await SessionGoal.setStatus({
      sessionID: ctx.sessionID,
      status: params.status,
      expected,
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
          ...(params.blocker ? { blocker: params.blocker } : {}),
        },
        null,
        2,
      ),
      metadata: {
        goal: SessionGoal.publicInfo(goal),
        completionBudgetReport,
        ...(params.blocker ? { blocker: params.blocker } : {}),
      },
    }
  },
})
