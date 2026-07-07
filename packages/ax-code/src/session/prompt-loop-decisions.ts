import { providerModelKey } from "../provider/model-key"
import { ModelID, ProviderID } from "../provider/schema"
import { parseJsonRecord } from "../util/json-record"
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
  lastUserCreatedAt?: number
  lastAssistant?: Pick<MessageV2.Assistant, "id" | "finish"> & { time?: Pick<MessageV2.Assistant["time"], "created"> }
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
      stopWithoutFallback: boolean
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
      message?: string
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

function fallbackSwitchMessage(input: { providerID: ProviderID; reason: string; to: string }) {
  const punctuation = /[.!?]$/.test(input.reason) ? "" : "."
  return `Provider ${input.providerID} failed: ${input.reason}${punctuation} Switching to ${input.to}.`
}

export function providerFallbackLookupDecision(input: {
  consecutiveErrors: number
  error: unknown
}): ProviderFallbackLookupDecision {
  if (!input.error || typeof input.error !== "object") return { action: "skip" }

  const statusCode = providerErrorStatusCode(input.error)
  if (
    !providerErrorName(input.error) ||
    typeof statusCode !== "number" ||
    !PROVIDER_FALLBACK_STATUS_CODES.has(statusCode)
  ) {
    return { action: "skip" }
  }

  const errorMessage = providerErrorMessage(input.error)
  const stopWithoutFallback = shouldStopWithoutFallbackForProviderError({ statusCode, message: errorMessage })
  if (!stopWithoutFallback && !hasRepeatedErrors(input.consecutiveErrors, 2)) {
    return { action: "skip" }
  }

  return {
    action: "lookup",
    errorMessage,
    stopWithoutFallback,
  }
}

function providerErrorName(error: object) {
  const name = (error as { name?: unknown }).name
  return name === "APIError" || name === "AI_APICallError"
}

function providerErrorStatusCode(error: object) {
  const direct = (error as { statusCode?: unknown }).statusCode
  if (typeof direct === "number") return direct
  const data = (error as { data?: unknown }).data
  if (data && typeof data === "object") {
    const nested = (data as { statusCode?: unknown }).statusCode
    if (typeof nested === "number") return nested
  }
  return undefined
}

function providerErrorMessage(error: object) {
  const candidates: Array<string | undefined> = []
  const direct = (error as { message?: unknown }).message
  if (typeof direct === "string") candidates.push(direct)

  const data = (error as { data?: unknown }).data
  if (data && typeof data === "object") {
    const message = (data as { message?: unknown }).message
    if (typeof message === "string") candidates.push(message)

    const nestedError = (data as { error?: unknown }).error
    if (nestedError && typeof nestedError === "object") {
      const nestedMessage = (nestedError as { message?: unknown }).message
      if (typeof nestedMessage === "string") candidates.push(nestedMessage)
    }

    const parsedMessage = responseBodyMessage((data as { responseBody?: unknown }).responseBody)
    if (parsedMessage) candidates.push(parsedMessage)
  }

  const parsedMessage = responseBodyMessage((error as { responseBody?: unknown }).responseBody)
  if (parsedMessage) candidates.push(parsedMessage)

  return candidates.find(providerAccountFailureMessage) ?? candidates.find((message) => message !== undefined)
}

function responseBodyMessage(responseBody: unknown) {
  if (typeof responseBody !== "string") return undefined
  const parsed = parseJsonRecord(responseBody)
  const direct = parsed && typeof parsed.message === "string" ? parsed.message : undefined
  if (direct) return direct
  const directCode = parsed && typeof parsed.code === "string" ? parsed.code : undefined
  if (directCode) return directCode
  const nestedError = parsed && typeof parsed.error === "object" && parsed.error !== null ? parsed.error : undefined
  if (nestedError && "message" in nestedError && typeof nestedError.message === "string") return nestedError.message
  if (nestedError && "code" in nestedError && typeof nestedError.code === "string") return nestedError.code
  if (nestedError && "type" in nestedError && typeof nestedError.type === "string") return nestedError.type
  return undefined
}

function shouldStopWithoutFallbackForProviderError(input: { statusCode: number; message: string | undefined }) {
  if (input.statusCode === 401 || input.statusCode === 402 || input.statusCode === 403) return true
  if (providerAccountFailureMessage(input.message)) return true
  return false
}

function providerAccountFailureMessage(message: string | undefined) {
  const normalized = message?.toLowerCase() ?? ""
  if (!normalized) return false
  return (
    normalized.includes("quota") ||
    normalized.includes("credit") ||
    normalized.includes("billing") ||
    normalized.includes("exhausted") ||
    normalized.includes("insufficient") ||
    normalized.includes("unauthorized") ||
    normalized.includes("forbidden")
  )
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
    message: fallbackSwitchMessage({ providerID: input.current.providerID, reason, to }),
    nextConsecutiveErrors: reduceFallbackConsecutiveErrors(input.consecutiveErrors),
  }
}

export function processorLoopDecision(input: {
  result: SessionProcessor.Result
  messageFinish: string | undefined
  hasError: boolean
  priorContextOverflowCompactions?: number
}): ProcessorLoopDecision {
  if (input.result === "stop") {
    return { action: "stop", reason: input.hasError ? "error" : "completed" }
  }
  if (input.result !== "compact") return { action: "continue" }
  const overflow = !input.messageFinish
  if (overflow && (input.priorContextOverflowCompactions ?? 0) > 0) {
    return {
      action: "stop",
      reason: "error",
      message:
        "The request still exceeds the model context window after compaction. " +
        "This usually means the provider's fixed prompt/tool schema is too large for the selected local model. " +
        "Try a model with a larger context window or reduce the provider tool surface.",
    }
  }
  return {
    action: "compact",
    overflow,
    triggerReason: input.messageFinish ? "provider_usage" : "context_overflow_error",
  }
}

export function assistantRespondedAfterUser(input: AssistantTurnCursor): input is RespondedAssistantTurnCursor {
  if (!input.lastAssistant?.finish) return false
  // Prefer wall-clock timestamps to avoid ID-space ordering bugs across
  // clients. On an exact tie (both records created in the same millisecond,
  // realistic for autonomous continuations where the assistant record is
  // created immediately after the injected user message) fall back to the ID
  // compare — treating a tie as "not responded" re-ran the model on an
  // already-answered prompt, producing a duplicate turn.
  if (
    input.lastUserCreatedAt !== undefined &&
    input.lastAssistant.time?.created !== undefined &&
    input.lastUserCreatedAt !== input.lastAssistant.time.created
  ) {
    return input.lastUserCreatedAt < input.lastAssistant.time.created
  }
  return input.lastUserID < input.lastAssistant.id
}

export function assistantLoopExitDecision(
  input: AssistantTurnCursor & {
    hasPendingSubtask: boolean
    // True when the session has autonomous work outstanding (pending todos or
    // an active goal in an autonomous session). An unknown-finish turn must
    // not end such a session as "completed": the provider merely omitted a
    // finish reason, and stopping here would mark unfinished todos done and
    // leave an active goal stranded. Returning "continue" is bounded — the
    // tool-only-turn circuit breaker and the step ceilings still stop a model
    // that keeps producing unknown finishes.
    hasPendingAutonomousWork?: boolean
  },
): AssistantLoopExitDecision {
  if (!assistantRespondedAfterUser(input)) return { action: "continue" }

  const finish = input.lastAssistant.finish
  if (modelTurnFinished(finish)) {
    return { action: "complete" }
  }

  if (finish === "unknown" && !input.hasPendingSubtask && !input.hasPendingAutonomousWork) {
    return {
      action: "complete_unknown_finish",
      logMessage: "model returned unknown finish with no actionable output",
    }
  }

  return { action: "continue" }
}
