import { SessionGoal } from "./goal"
import { GoalPlanOrchestration } from "./goal-plan-orchestration"
import type { MessageV2 } from "./message-v2"
import { createStoppedAssistantTextResponse } from "./prompt-assistant-response"
import { commandModel } from "./prompt-command-selection"
import { parseGoalArguments } from "./prompt-goal-arguments"
import type { CommandInput, PromptInput } from "./prompt-input"
import { createUserMessage } from "./prompt-user-message"
import { toErrorMessage } from "../util/error-message"

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
    let prepared: Awaited<ReturnType<typeof GoalPlanOrchestration.resumeWithPlan>>
    try {
      prepared = await GoalPlanOrchestration.resumeWithPlan({
        sessionID: input.sessionID,
        model,
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
    prepared = await GoalPlanOrchestration.activate({
      sessionID: input.sessionID,
      objective: parsed.objective,
      tokenBudget: parsed.tokenBudget,
      replace: false,
      model,
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
