import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import type { ModelID, ProviderID } from "../provider/schema"
import { MessageV2 } from "./message-v2"
import type { SessionID } from "./schema"

export async function lastModel(sessionID: SessionID) {
  for await (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) return item.info.model
  }
  return Provider.defaultModel()
}

export async function commandModel(input: {
  command?: { model?: string; agent?: string }
  model?: string
  sessionID: SessionID
}) {
  if (input.command?.model) {
    return Provider.parseModel(input.command.model)
  }
  if (input.command?.agent) {
    const agent = await Agent.get(input.command.agent)
    if (agent?.model) {
      return agent.model
    }
  }
  if (input.model) return Provider.parseModel(input.model)
  return lastModel(input.sessionID)
}

export async function commandUser(input: {
  subtask: boolean
  inputAgent?: string
  inputModel?: string
  agentName: string
  taskModel: { providerID: ProviderID; modelID: ModelID }
  sessionID: SessionID
  defaultAgent?: () => Promise<string>
  parseModel?: (model: string) => { providerID: ProviderID; modelID: ModelID }
  last?: (sessionID: SessionID) => Promise<{ providerID: ProviderID; modelID: ModelID }>
}) {
  if (!input.subtask) {
    return {
      agent: input.agentName,
      model: input.taskModel,
    }
  }

  return {
    agent: input.inputAgent ?? (await (input.defaultAgent ?? Agent.defaultAgent)()),
    model: input.inputModel
      ? (input.parseModel ?? Provider.parseModel)(input.inputModel)
      : await (input.last ?? lastModel)(input.sessionID),
  }
}
