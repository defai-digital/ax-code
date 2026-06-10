import type { Agent } from "../agent/agent"
import { NativePerf } from "../perf/native"
import { Plugin } from "../plugin"
import type { Provider } from "../provider/provider"
import MAX_STEPS from "./prompt/max-steps.txt"
import { MessageV2 } from "./message-v2"
import { remindQueuedMessages } from "./prompt-loop-messages"
import { systemPrompt as getSystemPrompt } from "./prompt-system"
import type { SessionID } from "./schema"

export type PromptRequestCache = Parameters<typeof getSystemPrompt>[0]["cache"]

export async function preparePromptRequest(input: {
  sessionID: SessionID
  messages: MessageV2.WithParts[]
  lastUser: MessageV2.User
  lastFinished?: MessageV2.Assistant
  step: number
  isLastStep: boolean
  agent: Agent.Info
  model: Provider.Model
  cache: PromptRequestCache
  structuredPrompt: string
}) {
  return NativePerf.runAsync(
    "session.preparePromptRequest",
    { step: input.step, messages: input.messages.length },
    () => buildPromptRequest(input),
  )
}

async function buildPromptRequest(input: Parameters<typeof preparePromptRequest>[0]) {
  let messages = input.messages
  // Ephemerally wrap queued user messages with a reminder to stay on track.
  if (input.step > 1) messages = remindQueuedMessages(messages, input.lastFinished)

  await Plugin.trigger("experimental.chat.messages.transform", {}, { messages })
  // The per-message conversion cache relies on message objects being
  // replaced (never mutated in place) when their content changes. A plugin
  // implementing the transform hook can mutate messages arbitrarily, so
  // disable the cache when one is registered.
  const hasTransformPlugin = (await Plugin.list()).some((hook) => hook["experimental.chat.messages.transform"])

  // Build system prompt and convert messages to model format in parallel.
  // Both walk the same messages/model independently with no side effects.
  const format = input.lastUser.format ?? { type: "text" }
  const [system, modelMessages] = await Promise.all([
    getSystemPrompt({
      agent: input.agent,
      model: input.model,
      format,
      cache: input.cache,
      messages,
      sessionID: input.sessionID,
      structuredPrompt: input.structuredPrompt,
    }),
    MessageV2.toModelMessages(messages, input.model, { cache: !hasTransformPlugin }),
  ])
  const requestMessages = [
    ...modelMessages,
    ...(input.isLastStep
      ? [
          {
            role: "assistant" as const,
            content: MAX_STEPS,
          },
        ]
      : []),
  ]

  return {
    messages,
    format,
    system,
    requestMessages,
  }
}
