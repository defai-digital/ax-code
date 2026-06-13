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

type PromptLoopErrorTransition =
  | {
      action: "continue"
      consecutiveErrors: number
      fallbackModelOverride: MessageV2.User["model"] | undefined
      resetCachedModel: boolean
    }
  | {
      action: "retry"
      consecutiveErrors: number
      fallbackModelOverride: MessageV2.User["model"]
      resetCachedModel: true
    }
  | {
      action: "stop"
      reason: "error"
      consecutiveErrors: number
      fallbackModelOverride: MessageV2.User["model"] | undefined
      resetCachedModel: boolean
    }

type PromptLoopErrorTransitionDeps = {
  handleError?: typeof handlePromptLoopError
}

type PromptLoopErrorDeps = {
  findFallback?: (
    providerID: MessageV2.User["model"]["providerID"],
    preferredModelID?: MessageV2.User["model"]["modelID"],
    excludedProviderIDs?: Iterable<MessageV2.User["model"]["providerID"]>,
  ) => Promise<MessageV2.User["model"] | undefined>
  warn?: (message: string, fields: Record<string, unknown>) => void
  publishError?: (input: { sessionID: SessionID; message: string }) => void
}

function providerFallbackUnavailableMessage(input: {
  providerID: MessageV2.User["model"]["providerID"]
  errorMessage: string | undefined
}) {
  const reason = input.errorMessage?.trim() || "unknown error"
  const punctuation = /[.!?]$/.test(reason) ? "" : "."
  return `Provider ${input.providerID} failed: ${reason}${punctuation} No fallback provider available.`
}

export async function handlePromptLoopError(
  input: {
    sessionID: SessionID
    currentModel: MessageV2.User["model"]
    error: unknown
    consecutiveErrors: number
    step: number
    failedProviderIDs?: Iterable<MessageV2.User["model"]["providerID"]>
  },
  deps: PromptLoopErrorDeps = {},
): Promise<PromptLoopErrorResult> {
  // Provider fallback: if the error is a provider API failure (rate limit,
  // no credit, auth error), try switching to another available provider
  // instead of retrying the same broken one.
  const fallbackLookup = providerFallbackLookupDecision({
    consecutiveErrors: input.consecutiveErrors,
    error: input.error,
  })
  if (fallbackLookup.action === "lookup") {
    const fallback = await (deps.findFallback ?? findFallbackModel)(
      input.currentModel.providerID,
      input.currentModel.modelID,
      input.failedProviderIDs,
    ).catch(() => undefined)
    if (fallback) {
      const fallbackSwitch = providerFallbackSwitchState({
        current: input.currentModel,
        fallback,
        errorMessage: fallbackLookup.errorMessage,
        consecutiveErrors: input.consecutiveErrors,
      })
      ;(deps.warn ?? log.warn)("switching to fallback provider", {
        command: "session.prompt.loop",
        from: fallbackSwitch.from,
        to: fallbackSwitch.to,
        reason: fallbackSwitch.reason,
      })
      ;(deps.publishError ?? Session.publishError)({
        sessionID: input.sessionID,
        message: fallbackSwitch.message,
      })
      return {
        action: "fallback",
        fallbackModel: fallback,
        consecutiveErrors: fallbackSwitch.nextConsecutiveErrors,
      }
    }

    if (fallbackLookup.stopWithoutFallback) {
      const message = providerFallbackUnavailableMessage({
        providerID: input.currentModel.providerID,
        errorMessage: fallbackLookup.errorMessage,
      })
      ;(deps.warn ?? log.warn)("no fallback provider available", {
        command: "session.prompt.loop",
        status: "error",
        errorCode: "PROVIDER_FALLBACK_UNAVAILABLE",
        providerID: input.currentModel.providerID,
        reason: fallbackLookup.errorMessage ?? "unknown error",
      })
      ;(deps.publishError ?? Session.publishError)({
        sessionID: input.sessionID,
        message,
      })
      return { action: "stop", reason: "error", consecutiveErrors: input.consecutiveErrors }
    }
  }

  ;(deps.warn ?? log.warn)("consecutive error", {
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
    ;(deps.warn ?? log.warn)("too many consecutive errors, stopping", {
      command: "session.prompt.loop",
      status: "error",
      errorCode: "MAX_CONSECUTIVE_ERRORS",
      consecutiveErrors: input.consecutiveErrors,
      sessionID: input.sessionID,
    })
    ;(deps.publishError ?? Session.publishError)({
      sessionID: input.sessionID,
      message: errorDecision.message,
    })
    return { action: "stop", reason: errorDecision.reason, consecutiveErrors: input.consecutiveErrors }
  }

  return { action: "continue", consecutiveErrors: input.consecutiveErrors }
}

export async function resolvePromptLoopErrorTransition(
  input: {
    sessionID: SessionID
    currentModel: MessageV2.User["model"]
    error: unknown
    consecutiveErrors: number
    fallbackModelOverride: MessageV2.User["model"] | undefined
    step: number
    failedProviderIDs?: Iterable<MessageV2.User["model"]["providerID"]>
  },
  deps: PromptLoopErrorTransitionDeps = {},
): Promise<PromptLoopErrorTransition> {
  if (!input.error) {
    return {
      action: "continue",
      consecutiveErrors: 0,
      fallbackModelOverride: input.fallbackModelOverride,
      resetCachedModel: false,
    }
  }

  const errorResult = await (deps.handleError ?? handlePromptLoopError)({
    sessionID: input.sessionID,
    currentModel: input.currentModel,
    error: input.error,
    consecutiveErrors: input.consecutiveErrors + 1,
    step: input.step,
    failedProviderIDs: input.failedProviderIDs,
  })

  if (errorResult.action === "fallback") {
    return {
      action: "retry",
      consecutiveErrors: errorResult.consecutiveErrors,
      fallbackModelOverride: errorResult.fallbackModel,
      resetCachedModel: true,
    }
  }

  if (errorResult.action === "stop") {
    return {
      action: "stop",
      reason: errorResult.reason,
      consecutiveErrors: errorResult.consecutiveErrors,
      fallbackModelOverride: input.fallbackModelOverride,
      resetCachedModel: false,
    }
  }

  return {
    action: "continue",
    consecutiveErrors: errorResult.consecutiveErrors,
    fallbackModelOverride: input.fallbackModelOverride,
    resetCachedModel: false,
  }
}
