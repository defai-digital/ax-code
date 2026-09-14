import { MessageV2 } from "../session/message-v2"

/** A delegated task may inherit restrictions, never its parent's tool grants. */
export async function taskParentConstraints(message: MessageV2.Assistant) {
  const parent = await MessageV2.get({ sessionID: message.sessionID, messageID: message.parentID })
  if (parent.info.role !== "user") throw new Error("Task parent must be a user message")
  return {
    isolation: parent.info.isolation,
    tools: Object.fromEntries(Object.entries(parent.info.tools ?? {}).filter(([, enabled]) => enabled === false)),
  }
}
