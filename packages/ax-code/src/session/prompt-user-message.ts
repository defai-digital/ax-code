import { Agent } from "../agent/agent"
import { Plugin } from "../plugin"
import { defer } from "../util/defer"
import { InstructionPrompt } from "./instruction"
import { MessageV2 } from "./message-v2"
import { resolveUserMessageParts } from "./prompt-message-parts"
import { validateUserMessageForSave } from "./prompt-message-validation"
import { PromptPartInput } from "./prompt-part-input"
import { getLastUserInfo } from "./prompt-request"
import { resolveUserMessageRouting } from "./prompt-routing"
import { lastModel, requestedModel } from "./prompt-command-selection"
import { Session } from "."
import { MessageID, type SessionID } from "./schema"
import type { ModelID, ProviderID } from "../provider/schema"
import { providerModelEquals } from "../provider/model-key"
import type { PromptIsolationPolicy } from "./prompt-runtime-policy"

export type CreateUserMessageInput = {
  sessionID: SessionID
  messageID?: MessageID
  model?: {
    providerID: ProviderID
    modelID: ModelID
  }
  agent?: string
  agentRouting?: "auto" | "preserve"
  noReply?: boolean
  tools?: Record<string, boolean>
  isolation?: PromptIsolationPolicy
  format?: MessageV2.OutputFormat
  system?: string
  variant?: string
  requestedDepth?: "fast" | "standard" | "deep" | "xdeep"
  parts: PromptPartInput[]
}

export async function createAutonomousUserContinuation(args: {
  sessionID: SessionID
  messages: readonly MessageV2.WithParts[]
  parts: CreateUserMessageInput["parts"]
}) {
  const lastUserInfo = getLastUserInfo(args.messages)
  await createUserMessage({
    sessionID: args.sessionID,
    agentRouting: "preserve",
    parts: args.parts,
    agent: lastUserInfo?.agent,
    model: lastUserInfo?.model,
  })
}

export async function createAutonomousTextContinuation(args: {
  sessionID: SessionID
  messages: readonly MessageV2.WithParts[]
  text: string
}) {
  await createAutonomousUserContinuation({
    sessionID: args.sessionID,
    messages: args.messages,
    parts: [{ type: "text", text: args.text }],
  })
}

export async function createUserMessage(input: CreateUserMessageInput) {
  const messageID = input.messageID ?? MessageID.ascending()
  let agentName = input.agent || (await Agent.defaultAgent())
  const messageText = input.parts
    .filter((p): p is typeof p & { type: "text" } => p.type === "text")
    .map((p) => p.text)
    .join(" ")

  // The client's model, followed to the connected provider serving the same
  // SKU when its own provider is disabled: config, docs, and `run --model`
  // keep naming a model by its native provider after a gateway took it over.
  const requested = input.model ? await requestedModel(input.model) : undefined
  const route = await resolveUserMessageRouting({
    sessionID: input.sessionID,
    messageID,
    agentName,
    messageText,
    parts: input.parts,
    agentRouting: input.agentRouting,
    requestedModel: requested,
  })
  agentName = route.agentName
  const agent = route.agent
  const complexityModel = route.complexityModel
  const hybridModel = route.hybridModel

  const pinned = route.pinnedModel
  // Auto-routing changes the agent for this turn, but it must not replace a
  // model the user explicitly submitted. The selected agent's pin is only a
  // fallback when no requested model exists.
  const model = complexityModel ?? hybridModel ?? requested ?? pinned ?? (await lastModel(input.sessionID))
  // The agent's variant only applies while the turn runs on the agent's own
  // model (or the agent pins none); a fallback model may not accept it.
  const agentVariantApplies =
    !requested && (!agent.model || (pinned !== undefined && providerModelEquals(model, pinned)))
  const variant =
    input.variant ??
    (!complexityModel && !hybridModel && agentVariantApplies && agent.variant ? agent.variant : undefined)

  const info: MessageV2.User = {
    id: messageID,
    role: "user",
    sessionID: input.sessionID,
    time: {
      created: Date.now(),
    },
    tools: input.tools,
    agent: agent.name,
    model,
    system: input.system,
    format: input.format,
    isolation: input.isolation,
    variant,
    requestedDepth: input.requestedDepth,
  }
  using _ = defer(() => InstructionPrompt.clear(info.id))

  const parts = await resolveUserMessageParts({
    sessionID: input.sessionID,
    messageID: info.id,
    agentName,
    agentPermission: agent.permission,
    parts: input.parts,
  })

  await Plugin.trigger(
    "chat.message",
    {
      sessionID: input.sessionID,
      agent: input.agent,
      model: input.model,
      messageID: input.messageID,
      variant: input.variant,
    },
    {
      message: info,
      parts,
    },
  )

  validateUserMessageForSave({ sessionID: input.sessionID, info, parts })
  await Session.updateMessageWithParts(info, parts)

  return {
    info,
    parts,
  }
}
