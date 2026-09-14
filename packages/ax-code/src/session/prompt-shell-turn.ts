import { ulid } from "ulid"
import { Session } from "."
import { MessageV2 } from "./message-v2"
import { MessageID, PartID, type SessionID } from "./schema"
import { sessionAssistantPath, textPart, zeroTokenUsage } from "./prompt-message-builders"
import { providerModelEquals } from "../provider/model-key"
import type { ModelID, ProviderID } from "../provider/schema"

export async function createShellTurnMessages(input: {
  sessionID: SessionID
  agent: string
  model: {
    providerID: ProviderID
    modelID: ModelID
  }
  command: string
}): Promise<{
  msg: MessageV2.Assistant
  part: MessageV2.ToolPart
}> {
  const prior = (await Session.messages({ sessionID: input.sessionID })).findLast(
    (message) => message.info.role === "user" && !message.parts.some((part) => part.type === "compaction"),
  )
  const source = prior?.info.role === "user" ? prior.info : undefined
  const userMsg: MessageV2.User = {
    id: MessageID.ascending(),
    sessionID: input.sessionID,
    time: {
      created: Date.now(),
    },
    role: "user",
    agent: input.agent,
    tools: source?.tools,
    isolation: source?.isolation,
    system: source?.system,
    format: source?.format,
    requestedDepth: source?.requestedDepth,
    variant: source && providerModelEquals(source.model, input.model) ? source.variant : undefined,
    model: {
      providerID: input.model.providerID,
      modelID: input.model.modelID,
    },
  }
  await Session.updateMessage(userMsg)

  const userPart = textPart({
    messageID: userMsg.id,
    sessionID: input.sessionID,
    text: "The following tool was executed by the user",
    synthetic: true,
  })
  await Session.updatePart(userPart)

  const msg: MessageV2.Assistant = {
    id: MessageID.ascending(),
    sessionID: input.sessionID,
    parentID: userMsg.id,
    mode: input.agent,
    agent: input.agent,
    path: sessionAssistantPath(),
    time: {
      created: Date.now(),
    },
    role: "assistant",
    tokens: zeroTokenUsage(),
    modelID: input.model.modelID,
    providerID: input.model.providerID,
  }
  await Session.updateMessage(msg)

  const part: MessageV2.ToolPart = {
    type: "tool",
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID: input.sessionID,
    tool: "bash",
    callID: ulid(),
    state: {
      status: "running",
      time: {
        start: Date.now(),
      },
      input: {
        command: input.command,
      },
    },
  }
  await Session.updatePart(part)

  return { msg, part }
}
