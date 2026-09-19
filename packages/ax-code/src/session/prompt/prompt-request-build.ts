import { projectCurrentLoopControls } from "./prompt-missing-answer"
import { ReasoningPolicy } from "../../control-plane/reasoning-policy"
import type { Agent } from "../../agent/agent"
import { NativePerf } from "../../perf/native"
import { Plugin } from "../../plugin"
import type { Provider } from "../../provider/provider"
import MAX_STEPS from "./max-steps.txt"
import { MessageV2 } from "../message-v2"
import type { MediaProjection } from "../media-projection"
import { remindQueuedMessages } from "./prompt-loop-messages"
import { systemPrompt as getSystemPrompt } from "./prompt-system"
import type { SessionID } from "../schema"
import { Config } from "@/config/config"
import { recoverUserImages } from "../media-recovery"
import { projectTailReminders } from "../reminder-projection"
import { AutonomousContinuationPrompt } from "./prompt-autonomous-continuations"

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
  requestMessagesSource?: MessageV2.WithParts[]
  environmentOverride?: string[]
  turnInstruction?: string
  mediaProjection?: MediaProjection.Mode
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

  // A turn profile can project a deliberately small, request-only view of the
  // durable transcript (for example: previous assistant answer + current user
  // rewrite request). Clone-based callers keep `messages` as the full loop
  // history while plugins and model conversion operate on the bounded view.
  const requestMessagesSource = projectCurrentLoopControls(input.requestMessagesSource ?? messages)

  await Plugin.trigger("experimental.chat.messages.transform", {}, { messages: requestMessagesSource })
  // The per-message conversion cache relies on message objects being
  // replaced (never mutated in place) when their content changes. A plugin
  // implementing the transform hook can mutate messages arbitrarily, so
  // disable the cache when one is registered.
  const hasTransformPlugin = (await Plugin.list()).some((hook) => hook["experimental.chat.messages.transform"])

  // Build system prompt and convert messages to model format in parallel.
  // Both walk the same messages/model independently with no side effects.
  const format = input.lastUser.format ?? { type: "text" }
  const projection =
    (await Config.get()).experimental?.tail_reminders === true
      ? projectTailReminders(requestMessagesSource)
      : { messages: requestMessagesSource, reminder: undefined }
  const goalPlanReminder =
    !input.isLastStep &&
    AutonomousContinuationPrompt.goalPlanDeadline({
      agentName: input.agent.name,
      step: input.step,
      maxSteps: input.agent.steps ?? Infinity,
    })
  // Loop checkpoints belong after the evidence. Changing the leading system
  // block invalidates local prefix snapshots on every reminder/recovery turn.
  const requestReminder = [projection.reminder, goalPlanReminder, input.turnInstruction].filter(Boolean).join("\n\n")
  const convertMessages = async (mediaProjection: MediaProjection.Mode) => {
    const source =
      mediaProjection === "normal"
        ? projection.messages
        : await recoverUserImages({
            messages: projection.messages,
            userID: input.lastUser.id,
            mode: mediaProjection,
            config: (await Config.get()).attachment?.image,
          })
    const modelMessages = await MessageV2.toModelMessages(source, input.model, {
      cache: !hasTransformPlugin,
      mediaProjection,
      preserveUserMedia: input.lastUser.id,
    })
    return {
      toolFailureCount: ReasoningPolicy.failureCount(modelMessages),
      messages: [
        ...modelMessages,
        ...(requestReminder ? [{ role: "user" as const, content: requestReminder }] : []),
        ...(input.isLastStep
          ? [
              {
                role: "assistant" as const,
                content: MAX_STEPS,
              },
            ]
          : []),
      ],
    }
  }
  const mediaProjection = input.mediaProjection ?? "normal"
  const [baseSystem, requestMessages] = await Promise.all([
    getSystemPrompt({
      agent: input.agent,
      model: input.model,
      format,
      cache: input.cache,
      // Projection changes model-visible history, not the applicability of
      // user memory or skills selected from the full conversation.
      messages: input.requestMessagesSource ? messages : requestMessagesSource,
      structuredPrompt: input.structuredPrompt,
      // A turn may replace environment scaffolding, never required instructions.
      environmentOverride: input.environmentOverride,
    }),
    convertMessages(mediaProjection),
  ])

  return {
    messages,
    requestMessagesSource,
    format,
    system: baseSystem,
    requestMessages: requestMessages.messages,
    toolFailureCount: requestMessages.toolFailureCount,
    mediaCount: MessageV2.requestMediaCount(requestMessagesSource),
    protectedMediaCount: MessageV2.requestMediaCount(
      requestMessagesSource.filter((message) => message.info.id === input.lastUser.id),
    ),
    projectMessages: async (mode: MediaProjection.Mode) => (await convertMessages(mode)).messages,
  }
}
