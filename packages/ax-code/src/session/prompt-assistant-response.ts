import { Session } from "."
import { MessageV2 } from "./message-v2"
import { MessageID, type SessionID } from "./schema"
import { sessionAssistantPath, textPart, zeroTokenUsage } from "./prompt-message-builders"

type ParentUser = Pick<MessageV2.User, "id" | "agent" | "variant" | "model">

export async function createStoppedAssistantTextResponse(input: {
  sessionID: SessionID
  parent: ParentUser
  text: string
  synthetic?: boolean
  error?: MessageV2.Assistant["error"]
  tokenTotal?: number
}): Promise<{ info: MessageV2.Assistant; parts: [MessageV2.TextPart] }> {
  const created = Date.now()
  const assistant: MessageV2.Assistant = {
    id: MessageID.ascending(),
    parentID: input.parent.id,
    role: "assistant",
    mode: input.parent.agent,
    agent: input.parent.agent,
    variant: input.parent.variant,
    path: sessionAssistantPath(),
    tokens: zeroTokenUsage(input.tokenTotal === undefined ? undefined : { total: input.tokenTotal }),
    modelID: input.parent.model.modelID,
    providerID: input.parent.model.providerID,
    time: {
      created,
      completed: created,
    },
    sessionID: input.sessionID,
    finish: "stop",
    ...(input.error === undefined ? {} : { error: input.error }),
  }
  const part = textPart({
    messageID: assistant.id,
    sessionID: input.sessionID,
    text: input.text,
    ...(input.synthetic === undefined ? {} : { synthetic: input.synthetic }),
    ...(input.synthetic
      ? {
          time: {
            start: created,
            end: created,
          },
        }
      : {}),
  })
  await Session.updateMessageWithParts(assistant, [part])
  return { info: assistant, parts: [part] }
}
