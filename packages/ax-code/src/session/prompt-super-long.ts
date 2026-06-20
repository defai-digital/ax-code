import { Session } from "."
import { Log } from "../util/log"
import type { MessageV2 } from "./message-v2"
import { assistantRespondedAfterUser } from "./prompt-loop-decisions"
import { createSyntheticFailureAssistant } from "./prompt-loop-failure"
import type { SessionID } from "./schema"
import { SuperLongPolicy } from "./super-long-policy"
import { SuperLongRuntime } from "./super-long-runtime"

const log = Log.create({ service: "session.prompt" })

export type PromptSuperLongDeadlineResult =
  | { action: "continue"; enabled: boolean }
  | { action: "stop"; reason: "step_limit"; invalidatedMessages: boolean }

export async function enforceSuperLongDeadline(input: {
  sessionID: SessionID
  lastUser: MessageV2.User
  lastAssistant?: MessageV2.Assistant
  autonomous: boolean
  config?: SuperLongPolicy.RuntimeConfig
  now?: number
}): Promise<PromptSuperLongDeadlineResult> {
  const state = SuperLongPolicy.runtimeState({
    modelID: input.lastUser.model.modelID,
    config: input.config,
  })
  const enabled = input.autonomous && state.enabled
  // Skip entirely when disabled — a misconfigured duration must not stop
  // sessions that never opted into Super-Long.
  if (!enabled) return { action: "continue", enabled: false }
  const now = input.now ?? Date.now()
  const startedAt = await SuperLongRuntime.sessionStartedAt({ sessionID: input.sessionID, now }).catch((error) => {
    log.warn("failed to load durable super-long session start; using current loop start", {
      sessionID: input.sessionID,
      error,
    })
    return now
  })
  const deadline = SuperLongPolicy.deadline({
    enabled,
    startedAt,
    now,
    requestedDurationMs: input.config?.requestedDurationMs,
  })
  const stop = SuperLongPolicy.deadlineStopDecision({
    deadline,
    source: state.source,
  })
  if (stop.action === "continue") return { action: "continue", enabled: true }

  log.warn(stop.logMessage, {
    command: "session.prompt.loop",
    status: stop.status,
    errorCode: stop.errorCode,
    sessionID: input.sessionID,
    ...stop.details,
  })

  let invalidatedMessages = false
  if (
    !assistantRespondedAfterUser({
      lastUserID: input.lastUser.id,
      lastUserCreatedAt: input.lastUser.time.created,
      lastAssistant: input.lastAssistant,
    })
  ) {
    await createSyntheticFailureAssistant({
      sessionID: input.sessionID,
      lastUser: input.lastUser,
      message: stop.message,
    })
    invalidatedMessages = true
  }
  Session.publishError({
    sessionID: input.sessionID,
    message: stop.message,
  })
  return { action: "stop", reason: stop.reason, invalidatedMessages }
}
