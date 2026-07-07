import { Session } from "."
import { Log } from "../util/log"
import type { MessageV2 } from "./message-v2"
import { assistantRespondedAfterUser } from "./prompt-loop-decisions"
import { createSyntheticFailureAssistant } from "./prompt-loop-failure"
import type { SessionID } from "./schema"
import { ScopedFlag } from "../flag/scoped"
import { SuperLongPolicy } from "./super-long-policy"
import { SuperLongRuntime } from "./super-long-runtime"

const log = Log.create({ service: "session.prompt" })

export type PromptSuperLongDeadlineResult =
  | { action: "continue"; enabled: boolean; durableTotalSteps?: number }
  | { action: "stop"; reason: "step_limit"; invalidatedMessages: boolean }

export async function enforceSuperLongDeadline(input: {
  sessionID: SessionID
  lastUser: MessageV2.User
  lastAssistant?: MessageV2.Assistant
  autonomous: boolean
  config?: SuperLongPolicy.RuntimeConfig
  // Steps taken in the calling loop since the previous deadline check, so
  // the durable run record can accumulate a crash/restart-proof total.
  stepsSinceLastCheck?: number
  now?: number
}): Promise<PromptSuperLongDeadlineResult> {
  const state = SuperLongPolicy.runtimeState({
    modelID: input.lastUser.model.modelID,
    providerID: input.lastUser.model.providerID,
    config: input.config,
    scoped: ScopedFlag.superLong(),
  })
  const enabled = input.autonomous && state.enabled
  // Skip entirely when disabled — a misconfigured duration must not stop
  // sessions that never opted into Super-Long.
  if (!enabled) return { action: "continue", enabled: false }
  const now = input.now ?? Date.now()
  const run = await SuperLongRuntime.touchRun({
    sessionID: input.sessionID,
    now,
    stepsDelta: input.stepsSinceLastCheck,
  }).catch((error): { startedAt: number; totalSteps: number | undefined } => {
    log.warn("failed to load durable super-long session start; using current loop start", {
      sessionID: input.sessionID,
      error,
    })
    return { startedAt: now, totalSteps: undefined }
  })
  const startedAt = run.startedAt
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
  if (stop.action === "continue") return { action: "continue", enabled: true, durableTotalSteps: run.totalSteps }

  // A user prompt issued AFTER the window expired is a fresh supervised
  // interaction, not the tail of the long run. Degrade to a normal
  // (non-Super-Long) turn instead of stopping — otherwise the session is
  // permanently bricked: while Super-Long stays enabled, every new prompt
  // would re-emit the deadline stop before any work could happen.
  // durableTotalSteps is still returned: touchRun above already accumulated
  // `stepsSinceLastCheck` into the durable record, so the caller must advance
  // its reported-steps watermark — otherwise every later iteration of the
  // degraded run re-reports the same steps and inflates the durable counter.
  if (deadline.ok && deadline.expired && input.lastUser.time.created > startedAt + deadline.durationMs) {
    log.info("super-long window expired before this prompt; continuing without super-long", {
      command: "session.prompt.loop",
      status: "ok",
      sessionID: input.sessionID,
      startedAt,
      durationMs: deadline.durationMs,
    })
    return { action: "continue", enabled: false, durableTotalSteps: run.totalSteps }
  }

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
