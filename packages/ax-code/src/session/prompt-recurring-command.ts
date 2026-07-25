import type { MessageV2 } from "./message-v2"
import { createStoppedAssistantTextResponse } from "./prompt-assistant-response"
import { commandModel } from "./prompt-command-selection"
import type { CommandInput } from "./prompt-input"
import { parseRecurringArguments, formatLoopInterval } from "./prompt-recurring-arguments"
import { createUserMessage } from "./prompt-user-message"
import { SessionRecurring } from "./recurring"

// /loop command handler (ADR-050). Unlike /goal, no PromptRunner is
// needed: /loop itself never starts a turn — ticks submit turns later via
// SessionPrompt.prompt from the SessionRecurring timer.

async function loopControlMessage(input: CommandInput, text: string): Promise<MessageV2.WithParts> {
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
        text: `/loop ${input.arguments}`.trim(),
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

export async function executeRecurringCommand(input: CommandInput): Promise<MessageV2.WithParts> {
  const parsed = parseRecurringArguments(input.arguments)
  if (parsed.action === "error") {
    return loopControlMessage(input, parsed.message)
  }
  if (parsed.action === "status") {
    return loopControlMessage(input, SessionRecurring.format(SessionRecurring.get(input.sessionID)))
  }
  if (parsed.action === "stop") {
    const stopped = SessionRecurring.stop(input.sessionID)
    return loopControlMessage(
      input,
      stopped
        ? `Loop stopped after ${stopped.runs} run(s) and ${stopped.skips} busy-skip(s).`
        : "No loop is running in this session.",
    )
  }
  const { info, replaced } = SessionRecurring.start({
    sessionID: input.sessionID,
    intervalMs: parsed.intervalMs,
    prompt: parsed.prompt,
  })
  const lines = [
    `${replaced ? "Replaced the previous loop. " : ""}Loop started: every ${formatLoopInterval(info.intervalMs)}.`,
    SessionRecurring.format(info),
  ]
  return loopControlMessage(input, lines.join("\n"))
}
