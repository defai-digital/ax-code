import type { Agent } from "../agent/agent"
import type { Provider } from "../provider/provider"
import { Session } from "."
import { InstructionPrompt } from "./instruction"
import type { MessageV2 } from "./message-v2"
import { SessionProcessor } from "./processor"
import { sessionAssistantPath, zeroTokenUsage } from "./prompt-message-builders"
import { MessageID, type SessionID } from "./schema"

export async function createPromptProcessor(input: {
  sessionID: SessionID
  lastUser: MessageV2.User
  agent: Agent.Info
  model: Provider.Model
  abort: AbortSignal
  messages: MessageV2.WithParts[]
}) {
  const assistantMessage = (await Session.updateMessage({
    id: MessageID.ascending(),
    parentID: input.lastUser.id,
    role: "assistant",
    mode: input.agent.name,
    agent: input.agent.name,
    variant: input.lastUser.variant,
    path: sessionAssistantPath(),
    tokens: zeroTokenUsage(),
    modelID: input.model.id,
    providerID: input.model.providerID,
    time: {
      created: Date.now(),
    },
    sessionID: input.sessionID,
  })) as MessageV2.Assistant

  return SessionProcessor.create({
    assistantMessage,
    sessionID: input.sessionID,
    model: input.model,
    abort: input.abort,
    messages: input.messages,
  })
}

export function clearPromptProcessorInstructions(processor: SessionProcessor.Info) {
  InstructionPrompt.clear(processor.message.id)
}
