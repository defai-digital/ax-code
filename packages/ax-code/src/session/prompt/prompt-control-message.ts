import type { MessageV2 } from "../message-v2"
import { createStoppedAssistantTextResponse } from "./prompt-assistant-response"
import { commandModel } from "./prompt-command-selection"
import type { CommandInput } from "./prompt-input"
import { createUserMessage } from "./prompt-user-message"

// Shared renderer for control commands (/goal, /limits, /loop): records the
// user's command as a no-reply message and answers with a stopped assistant
// text response — the command outcome is plain text, never a model turn.
export async function controlCommandMessage(
  input: CommandInput,
  command: string,
  text: string,
): Promise<MessageV2.WithParts> {
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
        text: `${command} ${input.arguments}`.trim(),
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
