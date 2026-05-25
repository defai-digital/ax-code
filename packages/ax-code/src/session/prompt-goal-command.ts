import { SessionGoal } from "./goal"
import type { MessageV2 } from "./message-v2"
import { createStoppedAssistantTextResponse } from "./prompt-assistant-response"
import { commandModel } from "./prompt-command-selection"
import { parseGoalArguments } from "./prompt-goal-arguments"
import type { CommandInput, PromptInput } from "./prompt-input"
import { createUserMessage } from "./prompt-user-message"

type PromptRunner = (input: PromptInput) => Promise<MessageV2.WithParts>

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
    return goalControlMessage(input, SessionGoal.format(await SessionGoal.pause(input.sessionID)))
  }
  if (parsed.action === "resume") {
    return goalControlMessage(input, SessionGoal.format(await SessionGoal.resume(input.sessionID)))
  }
  if (parsed.action === "clear") {
    await SessionGoal.clear(input.sessionID)
    return goalControlMessage(input, "Goal cleared for this session.")
  }

  if (parsed.action !== "create") {
    throw new Error(`Unhandled goal action: ${parsed.action}`)
  }

  const goal = await SessionGoal.create({
    sessionID: input.sessionID,
    objective: parsed.objective,
    tokenBudget: parsed.tokenBudget,
    replace: false,
  })
  return prompt({
    sessionID: input.sessionID,
    messageID: input.messageID,
    agent: input.agent,
    model: await commandModel({ model: input.model, sessionID: input.sessionID }),
    variant: input.variant,
    parts: [
      {
        type: "text",
        text:
          `Goal set: ${goal.objective}\n\n` +
          `Work toward this goal until it is complete, blocked, paused, cleared, or budget-limited. ` +
          `Use get_goal to inspect current goal state and update_goal when the goal is complete or genuinely blocked.`,
      },
      ...(input.parts ?? []),
    ],
  })
}
