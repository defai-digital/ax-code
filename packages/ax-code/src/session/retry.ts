import type { NamedError } from "@ax-code/util/error"
import { MessageV2 } from "./message-v2"
import { iife } from "@/util/iife"

export namespace SessionRetry {
  export const RETRY_INITIAL_DELAY = 2000
  export const RETRY_BACKOFF_FACTOR = 2
  export const RETRY_MAX_DELAY_NO_HEADERS = 30_000 // 30 seconds
  export const RETRY_MAX_DELAY = 2_147_483_647 // max 32-bit signed integer for setTimeout
  export const RETRY_MAX_ATTEMPTS = 5

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
      signal.addEventListener("abort", abortHandler, { once: true })
    })
  }

  export function delay(attempt: number, error?: MessageV2.APIError) {
    if (error) {
      const headers = error.data.responseHeaders
      if (headers) {
        const retryAfterMs = headers["retry-after-ms"]
        if (retryAfterMs) {
          const parsedMs = Number.parseFloat(retryAfterMs)
          if (!Number.isNaN(parsedMs)) {
            return Math.min(parsedMs, RETRY_MAX_DELAY)
          }
        }

        const retryAfter = headers["retry-after"]
        if (retryAfter) {
          const parsedSeconds = Number.parseFloat(retryAfter)
          if (!Number.isNaN(parsedSeconds)) {
            // convert seconds to milliseconds — use high cap since the
            // server explicitly requested this delay via headers
            return Math.min(Math.ceil(parsedSeconds * 1000), RETRY_MAX_DELAY)
          }
          // Try parsing as HTTP date format
          const parsed = Date.parse(retryAfter) - Date.now()
          if (!Number.isNaN(parsed) && parsed > 0) {
            return Math.min(Math.ceil(parsed), RETRY_MAX_DELAY)
          }
        }

        return jitter(Math.min(RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1), RETRY_MAX_DELAY))
      }
    }

    return jitter(Math.min(RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1), RETRY_MAX_DELAY_NO_HEADERS))
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
    "insufficient balance",
    "no resource package",
    "quota exceeded",
    "billing",
    "payment required",
    "account suspended",
    "subscription",
  ]

  function isPermanentError(message: string): boolean {
    const lower = message.toLowerCase()
    return NON_RETRYABLE_PATTERNS.some((p) => lower.includes(p))
  }

  export function retryable(error: ReturnType<NamedError["toObject"]>) {
    // context overflow errors should not be retried
    if (MessageV2.ContextOverflowError.isInstance(error)) return undefined
    if (MessageV2.APIError.isInstance(error)) {
      if (!error.data.isRetryable) return undefined
      // Billing / quota exhaustion — retrying won't change the account
      // balance. Surface the error immediately instead of burning 60s
      // of exponential backoff. This overrides the AI SDK's blanket
      // `isRetryable: true` on all 429 responses.
      if (isPermanentError(error.data.message)) return undefined
      if (error.data.responseBody?.includes("FreeUsageLimitError"))
        return `Free usage exceeded, add credits https://github.com/defai-digital/ax-code`
      return error.data.message.includes("Overloaded") ? "Provider is overloaded" : error.data.message
    }

    const json = iife(() => {
      // Previously this had an unreachable fallthrough that called
      // `JSON.parse(error.data.message)` on a non-string, which always
      // threw a TypeError (caught by the surrounding catch). Replace
      // with an explicit early return so the logic reads clearly.
      if (typeof error.data?.message !== "string") return undefined
      try {
        return JSON.parse(error.data.message)
      } catch {
        return undefined
      }
    })
    try {
      if (!json || typeof json !== "object") return undefined
      const code = typeof json.code === "string" ? json.code : ""

      if (json.type === "error" && json.error?.type === "too_many_requests") {
        return "Too Many Requests"
      }
      if (code.includes("exhausted") || code.includes("unavailable")) {
        return "Provider is overloaded"
      }
      if (json.type === "error" && json.error?.code?.includes("rate_limit")) {
        return "Rate Limited"
      }
      return undefined
    } catch {
      return undefined
    }
  }
}
