import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import type { ModelID, ProviderID } from "../provider/schema"
import { MessageV2 } from "./message-v2"
import type { SessionID } from "./schema"
import { Log } from "../util/log"

const log = Log.create({ service: "session.model" })

type ModelRef = { providerID: ProviderID; modelID: ModelID }

/**
 * The agent's pinned model when it can be used; the same model ID on a
 * connected provider when the pinned provider is disabled or disconnected;
 * otherwise undefined so the caller falls back to the last selected model
 * (then any available model). A pin left behind after its provider was
 * disabled must not fail the turn.
 */
export async function agentModel(agent: { name: string; model?: ModelRef }): Promise<ModelRef | undefined> {
  if (!agent.model) return undefined
  const resolved = await Provider.resolvePinnedModel(agent.model)
  if (resolved && resolved.providerID !== agent.model.providerID) {
    log.warn("agent model moved to another provider", {
      agent: agent.name,
      modelID: agent.model.modelID,
      from: agent.model.providerID,
      to: resolved.providerID,
    })
  }
  if (resolved) return resolved
  log.warn("agent model is unavailable; using the last selected model", {
    agent: agent.name,
    providerID: agent.model.providerID,
    modelID: agent.model.modelID,
  })
  return undefined
}

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
    const pinned = agent ? await agentModel(agent) : undefined
    if (pinned) return pinned
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
