import { MAX_CONSECUTIVE_ERRORS } from "@/constants/session"
import { Log } from "../util/log"
import { Session } from "."
import type { MessageV2 } from "./message-v2"
import { findFallbackModel } from "./prompt-provider-fallback"
import {
  consecutiveErrorDecision,
  providerFallbackLookupDecision,
  providerFallbackSwitchState,
} from "./prompt-loop-decisions"
import type { SessionID } from "./schema"

const log = Log.create({ service: "session.prompt" })

type PromptLoopErrorResult =
  | { action: "continue"; consecutiveErrors: number }
  | { action: "fallback"; fallbackModel: MessageV2.User["model"]; consecutiveErrors: number }
  | { action: "stop"; reason: "error"; consecutiveErrors: number }

export async function handlePromptLoopError(input: {
  sessionID: SessionID
  currentModel: MessageV2.User["model"]
  error: unknown
  consecutiveErrors: number
  step: number
}): Promise<PromptLoopErrorResult> {
  // Provider fallback: if the error is a provider API failure (rate limit,
  // no credit, auth error), try switching to another available provider
  // instead of retrying the same broken one.
  const fallbackLookup = providerFallbackLookupDecision({
    consecutiveErrors: input.consecutiveErrors,
    error: input.error,
  })
  if (fallbackLookup.action === "lookup") {
    const fallback = await findFallbackModel(input.currentModel.providerID).catch(() => null)
    if (fallback) {
      const fallbackSwitch = providerFallbackSwitchState({
        current: input.currentModel,
        fallback,
        errorMessage: fallbackLookup.errorMessage,
        consecutiveErrors: input.consecutiveErrors,
      })
      log.warn("switching to fallback provider", {
        command: "session.prompt.loop",
        from: fallbackSwitch.from,
        to: fallbackSwitch.to,
        reason: fallbackSwitch.reason,
      })
      Session.publishError({
        sessionID: input.sessionID,
        message: fallbackSwitch.message,
      })
      return {
        action: "fallback",
        fallbackModel: fallback,
        consecutiveErrors: fallbackSwitch.nextConsecutiveErrors,
      }
    }
  }

  log.warn("consecutive error", {
    command: "session.prompt.loop",
    status: "error",
    errorCode: "CONSECUTIVE_ERROR",
    consecutiveErrors: input.consecutiveErrors,
    step: input.step,
    sessionID: input.sessionID,
    error: input.error,
  })
  const errorDecision = consecutiveErrorDecision({
    consecutiveErrors: input.consecutiveErrors,
    maxConsecutiveErrors: MAX_CONSECUTIVE_ERRORS,
    step: input.step,
  })
  if (errorDecision.action === "stop") {
    log.warn("too many consecutive errors, stopping", {
      command: "session.prompt.loop",
      status: "error",
      errorCode: "MAX_CONSECUTIVE_ERRORS",
      consecutiveErrors: input.consecutiveErrors,
      sessionID: input.sessionID,
    })
    Session.publishError({
      sessionID: input.sessionID,
      message: errorDecision.message,
    })
    return { action: "stop", reason: errorDecision.reason, consecutiveErrors: input.consecutiveErrors }
  }

  return { action: "continue", consecutiveErrors: input.consecutiveErrors }
}
