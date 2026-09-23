import { SessionGoal } from "../goal"
import { GoalPlanOrchestration } from "../goal-plan-orchestration"
import type { MessageV2 } from "../message-v2"
import { createStoppedAssistantTextResponse } from "./prompt-assistant-response"
import { commandModel } from "./prompt-command-selection"
import { parseGoalArguments } from "./prompt-goal-arguments"
import type { CommandInput, PromptInput } from "./prompt-input"
import { createUserMessage } from "./prompt-user-message"
import { toErrorMessage } from "../../util/error-message"

type PromptRunner = (input: PromptInput) => Promise<MessageV2.WithParts>

// Run a goal status transition that may reject (pause/resume throw when no goal
// is set, and resume throws when the token budget is exhausted) and render the
// outcome as user-facing text rather than letting the error escape the command.
async function goalControlText(action: () => Promise<SessionGoal.Info>): Promise<string> {
  try {
    return SessionGoal.format(await action())
  } catch (error) {
    return toErrorMessage(error, "Goal command failed.")
  }
}

async function goalControlMessage(input: CommandInput, text: string) {
  const model = await commandModel({ model: input.model, sessionID: input.sessionID })
  const user = await createUserMessage({
    sessionID: input.sessionID,
    messageID: input.messageID,
    agent: input.agent,
    model,
    agentRouting: "preserve",
    noReply: true,
    parts: [
      {
        type: "text",
        text: `/goal ${input.arguments}`.trim(),
      },
    ],
  })
  return createStoppedAssistantTextResponse({
    sessionID: input.sessionID,
    parent: user.info,
    text,
    tokenTotal: 0,
  })
}

async function cancelRunningSession(sessionID: CommandInput["sessionID"]) {
  const { SessionPrompt } = await import("../prompt")
  const { Session } = await import("..")
  try {
    SessionPrompt.assertNotBusy(sessionID)
    return
  } catch (error) {
    if (!(error instanceof Session.BusyError)) throw error
  }
  await SessionPrompt.cancel(sessionID)
}

export async function executeGoalCommand(input: CommandInput, prompt: PromptRunner) {
  const parsed = parseGoalArguments(input.arguments)
  if (parsed.action === "view") {
    return goalControlMessage(input, SessionGoal.format(await SessionGoal.get(input.sessionID)))
  }
  if (parsed.action === "pause") {
    return goalControlMessage(input, await goalControlText(() => SessionGoal.pause(input.sessionID)))
  }
  if (parsed.action === "resume") {
    // resume is an activation: it sets status back to "active", so it must
    // restart the prompt loop just like create does — otherwise the goal is
    // active on paper but the agent sits dormant until the next user message.
    // If the contract is missing (planner failure or pre-v1 goal), retry the
    // writer fail-closed before activating. Budget / missing-goal errors stay
    // control messages.
    const model = await commandModel({ model: input.model, sessionID: input.sessionID })
    // Resume reactivates the goal and submits a fresh continuation prompt, so
    // it must take over from any in-flight turn exactly like create/revise;
    // otherwise the goal is active on paper while the run sits queued.
    await cancelRunningSession(input.sessionID)
    let prepared: Awaited<ReturnType<typeof GoalPlanOrchestration.resumeWithPlan>>
    try {
      prepared = await GoalPlanOrchestration.resumeWithPlan({
        sessionID: input.sessionID,
        model,
        contextParts: input.parts,
        variant: input.variant,
      })
    } catch (error) {
      return goalControlMessage(input, toErrorMessage(error, "Goal command failed."))
    }
    return prompt({
      sessionID: input.sessionID,
      messageID: input.messageID,
      agent: input.agent,
      model,
      variant: input.variant,
      system: input.system,
      parts: [
        {
          type: "text",
          text: GoalPlanOrchestration.resumePrompt({
            objective: prepared.goal.objective,
            path: prepared.path,
          }),
        },
        ...(input.parts ?? []),
      ],
    })
  }
  if (parsed.action === "revise") {
    const model = await commandModel({ model: input.model, sessionID: input.sessionID })
    let prepared: Awaited<ReturnType<typeof GoalPlanOrchestration.revise>>
    try {
      const target = await GoalPlanOrchestration.revisionTarget(input.sessionID, parsed.correction)
      await cancelRunningSession(input.sessionID)
      prepared = await GoalPlanOrchestration.revise({
        expectedCreated: target.existing.time.created,
        sessionID: input.sessionID,
        correction: parsed.correction,
        model,
        contextParts: input.parts,
        variant: input.variant,
      })
    } catch (error) {
      return goalControlMessage(
        input,
        toErrorMessage(error, "Goal revision failed; the previous contract is retained."),
      )
    }
    await goalControlMessage(
      input,
      [
        "Goal plan revised. Previous contract and receipts are retained; all checks need fresh receipts for this revision.",
        `Previous plan: ${prepared.revision?.previousPath}`,
        `Current plan: ${prepared.path}`,
        ...(prepared.revision?.changes.length ? prepared.revision.changes : ["Acceptance criteria are unchanged."]),
      ].join("\n"),
    )
    return prompt({
      sessionID: input.sessionID,
      agent: input.agent,
      model,
      variant: input.variant,
      system: input.system,
      parts: [
        {
          type: "text",
          text: GoalPlanOrchestration.implementerPrompt({ objective: prepared.goal.objective, path: prepared.path }),
        },
        ...(input.parts ?? []),
      ],
    })
  }
  if (parsed.action === "clear") {
    await SessionGoal.clear(input.sessionID)
    return goalControlMessage(input, "Goal cleared for this session.")
  }

  if (parsed.action === "error") {
    return goalControlMessage(input, parsed.message)
  }

  if (parsed.action !== "create") {
    throw new Error(`Unhandled goal action: ${parsed.action}`)
  }

  // activate() rejects when an active/paused goal already exists, the budget
  // is invalid, or the plan writer fails closed. Surface those as a control
  // message instead of a 500/failed task.
  const model = await commandModel({ model: input.model, sessionID: input.sessionID })
  let prepared: Awaited<ReturnType<typeof GoalPlanOrchestration.activate>>
  try {
    const current = await SessionGoal.get(input.sessionID)
    if (current?.status === "active" || current?.status === "paused")
      throw new Error("This session already has an active goal; pause, clear or revise it first")
    if (parsed.tokenBudget !== undefined && (!Number.isSafeInteger(parsed.tokenBudget) || parsed.tokenBudget <= 0))
      throw new Error("Goal token budget must be a positive integer")
    if (
      parsed.timeBudgetSeconds !== undefined &&
      (!Number.isSafeInteger(parsed.timeBudgetSeconds) || parsed.timeBudgetSeconds <= 0)
    )
      throw new Error("Goal time budget must be a positive integer number of seconds")
    await cancelRunningSession(input.sessionID)
    prepared = await GoalPlanOrchestration.activate({
      sessionID: input.sessionID,
      objective: parsed.objective,
      tokenBudget: parsed.tokenBudget,
      timeBudgetSeconds: parsed.timeBudgetSeconds,
      replace: false,
      model,
      contextParts: input.parts,
      variant: input.variant,
    })
  } catch (error) {
    return goalControlMessage(input, toErrorMessage(error, "Goal command failed."))
  }
  return prompt({
    sessionID: input.sessionID,
    messageID: input.messageID,
    agent: input.agent,
    model,
    variant: input.variant,
    system: input.system,
    parts: [
      {
        type: "text",
        text: GoalPlanOrchestration.implementerPrompt({
          objective: prepared.goal.objective,
          path: prepared.path,
        }),
      },
      ...(input.parts ?? []),
    ],
  })
}
