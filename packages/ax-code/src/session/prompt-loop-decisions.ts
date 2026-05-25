import { providerModelKey } from "../provider/model-key"
import { ModelID, ProviderID } from "../provider/schema"
import type { SessionCompaction } from "./compaction"
import type { MessageV2 } from "./message-v2"
import { formatDecisionCount, modelTurnFinished } from "./prompt-autonomous-decisions"
import type { SessionProcessor } from "./processor"

type PendingCompactionDecision =
  | { type: "break"; reason: "completed" | "error" }
  | { type: "retry"; delayMs: number }
  | { type: "continue" }

type AssistantLoopExitDecision =
  | { action: "continue" }
  | { action: "complete" }
  | { action: "complete_unknown_finish"; logMessage: string }

type AssistantTurnCursor = {
  lastUserID: string
  lastAssistant?: Pick<MessageV2.Assistant, "id" | "finish">
}

type RespondedAssistantTurnCursor = AssistantTurnCursor & {
  lastAssistant: Pick<MessageV2.Assistant, "id" | "finish"> & { finish: string }
}

type ConsecutiveErrorDecision =
  | { action: "continue" }
  | {
      action: "stop"
      reason: "error"
      message: string
    }

type ProviderFallbackLookupDecision =
  | { action: "skip" }
  | {
      action: "lookup"
      errorMessage: string | undefined
    }

type ProviderModelIdentity = {
  providerID: ProviderID
  modelID: ModelID
}

type ProviderFallbackSwitchState = {
  from: string
  to: string
  reason: string
  message: string
  nextConsecutiveErrors: number
}

type ProcessorCompactionTriggerReason = Extract<
  SessionCompaction.TriggerReason,
  "provider_usage" | "context_overflow_error"
>

type ProcessorLoopDecision =
  | { action: "continue" }
  | {
      action: "stop"
      reason: "completed" | "error"
    }
  | {
      action: "compact"
      overflow: boolean
      triggerReason: ProcessorCompactionTriggerReason
    }

// Cap consecutive busy retries before giving up. 40 x 250ms ~= 10s, which
// matches the previous practical ceiling but turns an unbounded livelock
// (compaction stuck in-flight) into an explicit error path the loop can
// surface to the user.
const PENDING_COMPACTION_BUSY_RETRY_LIMIT = 40

function retryLimitReached(attempts: number | undefined, limit: number) {
  return !((attempts ?? 0) < limit)
}

export function pendingCompactionDecision(input: {
  result: Awaited<ReturnType<typeof SessionCompaction.process>>
  overflow?: boolean
  busyRetries?: number
}): PendingCompactionDecision {
  if (input.result === "stop") {
    return { type: "break", reason: input.overflow ? "error" : "completed" }
  }
  if (input.result === "busy") {
    if (retryLimitReached(input.busyRetries, PENDING_COMPACTION_BUSY_RETRY_LIMIT)) {
      return { type: "break", reason: "error" }
    }
    return { type: "retry", delayMs: 250 }
  }
  return { type: "continue" }
}

export function shouldScheduleUsageCompaction(input: {
  lastFinished?: Pick<MessageV2.Assistant, "summary" | "tokens">
  overflow: boolean
}) {
  return input.lastFinished !== undefined && input.lastFinished.summary !== true && input.overflow
}

export function consecutiveErrorDecision(input: {
  consecutiveErrors: number
  maxConsecutiveErrors: number
  step: number
}): ConsecutiveErrorDecision {
  if (!retryLimitReached(input.consecutiveErrors, input.maxConsecutiveErrors)) return { action: "continue" }

  return {
    action: "stop",
    reason: "error",
    message:
      `Agent encountered ${formatDecisionCount(input.consecutiveErrors)} consecutive errors at step ${input.step}. ` +
      `Stopping to prevent retry loop. Try rephrasing your request or breaking it into smaller tasks.`,
  }
}

const PROVIDER_FALLBACK_STATUS_CODES = new Set([401, 402, 403, 429])

function hasRepeatedErrors(value: number, threshold: number) {
  return Number.isFinite(value) && value >= threshold
}

function reduceFallbackConsecutiveErrors(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.floor(value / 2)
}

function fallbackErrorReason(message: string | undefined) {
  const reason = message?.trim()
  return reason ? reason : "unknown error"
}

export function providerFallbackLookupDecision(input: {
  consecutiveErrors: number
  error: unknown
}): ProviderFallbackLookupDecision {
  if (!hasRepeatedErrors(input.consecutiveErrors, 2)) return { action: "skip" }
  if (!input.error || typeof input.error !== "object") return { action: "skip" }

  const error = input.error as { name?: unknown; data?: { statusCode?: unknown; message?: unknown } }
  const statusCode = error.data?.statusCode
  if (error.name !== "APIError" || typeof statusCode !== "number" || !PROVIDER_FALLBACK_STATUS_CODES.has(statusCode)) {
    return { action: "skip" }
  }

  return {
    action: "lookup",
    errorMessage: typeof error.data?.message === "string" ? error.data.message : undefined,
  }
}

export function providerFallbackSwitchState(input: {
  current: ProviderModelIdentity
  fallback: ProviderModelIdentity
  errorMessage: string | undefined
  consecutiveErrors: number
}): ProviderFallbackSwitchState {
  const from = providerModelKey(input.current)
  const to = providerModelKey(input.fallback)
  const reason = fallbackErrorReason(input.errorMessage)
  return {
    from,
    to,
    reason,
    message: `Provider ${input.current.providerID} failed: ${reason}. Switching to ${to}.`,
    nextConsecutiveErrors: reduceFallbackConsecutiveErrors(input.consecutiveErrors),
  }
}

export function processorLoopDecision(input: {
  result: SessionProcessor.Result
  messageFinish: string | undefined
  hasError: boolean
}): ProcessorLoopDecision {
  if (input.result === "stop") {
    return { action: "stop", reason: input.hasError ? "error" : "completed" }
  }
  if (input.result !== "compact") return { action: "continue" }
  return {
    action: "compact",
    overflow: !input.messageFinish,
    triggerReason: input.messageFinish ? "provider_usage" : "context_overflow_error",
  }
}

export function assistantRespondedAfterUser(input: AssistantTurnCursor): input is RespondedAssistantTurnCursor {
  return Boolean(input.lastAssistant?.finish && input.lastUserID < input.lastAssistant.id)
}

export function assistantLoopExitDecision(input: AssistantTurnCursor & {
  hasPendingSubtask: boolean
}): AssistantLoopExitDecision {
  if (!assistantRespondedAfterUser(input)) return { action: "continue" }

  const finish = input.lastAssistant.finish
  if (modelTurnFinished(finish)) {
    return { action: "complete" }
  }

  if (finish === "unknown" && !input.hasPendingSubtask) {
    return {
      action: "complete_unknown_finish",
      logMessage: "model returned unknown finish with no actionable output",
    }
  }

  return { action: "continue" }
}
