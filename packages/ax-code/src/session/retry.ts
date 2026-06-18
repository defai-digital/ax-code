import type { NamedError } from "@ax-code/util/error"
import { MessageV2 } from "./message-v2"
import { parseJsonRecord } from "@/util/json-record"
import { GITHUB_REPO_URL } from "@/constants/project"
import { isRecord } from "@/util/record"

export namespace SessionRetry {
  const RETRY_INITIAL_DELAY = 2000
  const RETRY_BACKOFF_FACTOR = 2
  const RETRY_MAX_DELAY_NO_HEADERS = 30_000 // 30 seconds
  const RETRY_MAX_DELAY = 2_147_483_647 // max 32-bit signed integer for setTimeout
  export const RETRY_MAX_ATTEMPTS = 5
  const ALIBABA_TOKEN_PLAN_QUOTA_RETRY_DELAY = 60_000

  export async function sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError")
    return new Promise((resolve, reject) => {
      const abortHandler = () => {
        clearTimeout(timeout)
        reject(new DOMException("Aborted", "AbortError"))
      }
      const timeout = setTimeout(
        () => {
          signal.removeEventListener("abort", abortHandler)
          resolve()
        },
        Math.min(ms, RETRY_MAX_DELAY),
      )
      if (signal.aborted) {
        clearTimeout(timeout)
        reject(new DOMException("Aborted", "AbortError"))
        return
      }
      signal.addEventListener("abort", abortHandler, { once: true })
    })
  }

  function isAlibabaTokenPlanShortWindowQuota(error: MessageV2.APIError) {
    return error.data.metadata?.errorCode === "alibaba_token_plan_short_window_quota"
  }

  function numericHeaderDelay(value: string | undefined, multiplier: number) {
    if (value === undefined) return undefined
    const trimmed = value.trim()
    if (trimmed.length === 0) return undefined
    if (!/^(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) return undefined

    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed) || parsed < 0) return undefined

    return Math.min(Math.ceil(parsed * multiplier), RETRY_MAX_DELAY_NO_HEADERS)
  }

  function retryAfterDelay(value: string | undefined) {
    const secondsDelay = numericHeaderDelay(value, 1000)
    if (secondsDelay !== undefined) return secondsDelay
    if (value === undefined) return undefined

    const parsed = Date.parse(value) - Date.now()
    if (Number.isFinite(parsed) && parsed > 0) return Math.min(Math.ceil(parsed), RETRY_MAX_DELAY_NO_HEADERS)
    return undefined
  }

  function headerDelay(headers: MessageV2.APIError["data"]["responseHeaders"]) {
    const retryAfterMs = numericHeaderDelay(headers?.["retry-after-ms"], 1)
    if (retryAfterMs !== undefined) return retryAfterMs

    return retryAfterDelay(headers?.["retry-after"])
  }

  export function delay(attempt: number, error?: MessageV2.APIError) {
    if (error) {
      const headers = error.data.responseHeaders
      if (isAlibabaTokenPlanShortWindowQuota(error)) {
        const parsedHeaderDelay = headerDelay(headers)
        if (parsedHeaderDelay !== undefined) return parsedHeaderDelay
        return jitter(ALIBABA_TOKEN_PLAN_QUOTA_RETRY_DELAY)
      }
      if (headers) {
        const parsedHeaderDelay = headerDelay(headers)
        if (parsedHeaderDelay !== undefined) return parsedHeaderDelay

        return jitter(
          Math.min(RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1), RETRY_MAX_DELAY_NO_HEADERS),
        )
      }
    }

    return jitter(
      Math.min(RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1), RETRY_MAX_DELAY_NO_HEADERS),
    )
  }

  /** Add +/-25% jitter to prevent thundering herd on simultaneous retries. */
  function jitter(ms: number): number {
    return Math.round(ms * (0.75 + Math.random() * 0.5))
  }

  // Patterns that indicate the error is permanent — retrying the same
  // request won't fix it. The AI SDK marks all 429s as isRetryable, but
  // some 429s are billing/quota exhaustion, not rate limits. Retrying
  // those wastes ~60s of backoff before the user sees the real error.
  const NON_RETRYABLE_PATTERNS = [
    "allocated quota exceeded",
    "insufficient balance",
    "increase your quota limit",
    "no resource package",
    "quota exceeded",
    "quota has been exhausted",
    "token-limit",
    "insufficient quota",
    "insufficient_quota",
    "billing",
    "payment required",
    "account suspended",
    "subscription",
  ]

  function isPermanentError(message: string, responseBody?: string): boolean {
    const lower = `${message}\n${responseBody ?? ""}`.toLowerCase()
    return NON_RETRYABLE_PATTERNS.some((p) => lower.includes(p))
  }

  export function parseRetryMessageJson(message: unknown): Record<string, unknown> | undefined {
    return typeof message === "string" ? parseJsonRecord(message) : undefined
  }

  export function retryable(error: ReturnType<NamedError["toObject"]>) {
    // context overflow errors should not be retried
    if (MessageV2.ContextOverflowError.isInstance(error)) return undefined
    if (MessageV2.APIError.isInstance(error)) {
      const message = typeof error.data?.message === "string" ? error.data.message : "Unknown API error"
      if (!error.data?.isRetryable) return undefined
      if (isAlibabaTokenPlanShortWindowQuota(error)) return message
      // Billing / quota exhaustion — retrying won't change the account
      // balance. Surface the error immediately instead of burning 60s
      // of exponential backoff. This overrides the AI SDK's blanket
      // `isRetryable: true` on all 429 responses.
      if (isPermanentError(message, error.data.responseBody)) return undefined
      if (error.data.responseBody?.includes("FreeUsageLimitError"))
        return `Free usage exceeded, add credits ${GITHUB_REPO_URL}`
      return message.includes("Overloaded") ? "Provider is overloaded" : message
    }

    const json = parseRetryMessageJson(error.data?.message)
    if (!json) return undefined

    const code = typeof json.code === "string" ? json.code : ""
    const nestedError = isRecord(json.error) ? json.error : undefined
    if (json.type === "error" && nestedError?.type === "too_many_requests") {
      return "Too Many Requests"
    }
    if (code.includes("exhausted") || code.includes("unavailable")) {
      return "Provider is overloaded"
    }
    const nestedCode = nestedError && typeof nestedError.code === "string" ? nestedError.code : ""
    if (json.type === "error" && nestedCode.includes("rate_limit")) {
      return "Rate Limited"
    }
    return undefined
  }
}
