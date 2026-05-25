import { NamedError } from "@ax-code/util/error"
import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { Session } from "."
import type { SessionID } from "./schema"

type AgentLike = {
  hidden?: boolean
  name: string
}

type AgentInfo = NonNullable<Awaited<ReturnType<typeof Agent.get>>>
type ModelInfo = Awaited<ReturnType<typeof Provider.getModel>>

function publishAgentInfoError(input: {
  sessionID: SessionID
  message: string
  report?: (sessionID: SessionID, error: Record<string, unknown>) => unknown
}) {
  const error = new NamedError.Unknown({ message: input.message }).toObject()
  if (input.report) {
    input.report(input.sessionID, error)
    return error
  }
  Session.publishError({ sessionID: input.sessionID, error })
  return error
}

export async function agentInfo<T extends AgentLike = AgentInfo>(input: {
  sessionID: SessionID
  name: string
  get?: (name: string) => Promise<T | undefined>
  list?: () => Promise<T[]>
  report?: (sessionID: SessionID, error: Record<string, unknown>) => unknown
}) {
  const agent = await (input.get ?? Agent.get)(input.name)
  if (agent) return agent

  const available = await (input.list ?? Agent.list)().then((items) =>
    items.filter((item) => Agent.resolveTier(item) !== "internal").map((item) => item.name),
  )
  const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
  const errorMessage = `Agent not found: "${input.name}".${hint}`
  publishAgentInfoError({
    sessionID: input.sessionID,
    message: errorMessage,
    report: input.report,
  })
  throw new NamedError.Unknown({ message: errorMessage })
}

export async function modelInfo<T = ModelInfo>(input: {
  sessionID: SessionID
  providerID: ProviderID
  modelID: ModelID
  get?: (providerID: ProviderID, modelID: ModelID) => Promise<T>
  report?: (sessionID: SessionID, error: Record<string, unknown>) => unknown
}) {
  try {
    return await (input.get ?? Provider.getModel)(input.providerID, input.modelID)
  } catch (error) {
    if (Provider.ModelNotFoundError.isInstance(error)) {
      const { providerID, modelID, suggestions } = error.data
      const hint = suggestions?.length ? ` Did you mean: ${suggestions.join(", ")}?` : ""
      publishAgentInfoError({
        sessionID: input.sessionID,
        message: `Model not found: ${providerID}/${modelID}.${hint}`,
        report: input.report,
      })
    }
    throw error
  }
}
