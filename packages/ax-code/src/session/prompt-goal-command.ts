import { SessionGoal } from "./goal"
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
    // If resume rejects (no goal / budget exhausted), surface the error as a
    // control message instead of letting it escape as a 500/failed task,
    // matching how create reports validation errors in-session.
    let goal: SessionGoal.Info
    try {
      goal = await SessionGoal.resume(input.sessionID)
    } catch (error) {
      return goalControlMessage(input, toErrorMessage(error, "Goal command failed."))
    }
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
            `Goal resumed: ${goal.objective}\n\n` +
            `Continue working toward this goal until it is complete, blocked, paused, cleared, or budget-limited.`,
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

  // create() rejects when an active goal already exists or the budget is
  // invalid (e.g. `/goal --budget 0 ...`). Surface those as a friendly control
  // message instead of letting the raw error escape the command as a 500/failed
  // task — matching how view/pause/resume report state in-session.
  let goal: SessionGoal.Info
  try {
    goal = await SessionGoal.create({
      sessionID: input.sessionID,
      objective: parsed.objective,
      tokenBudget: parsed.tokenBudget,
      replace: false,
    })
  } catch (error) {
    return goalControlMessage(input, toErrorMessage(error, "Goal command failed."))
  }
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
