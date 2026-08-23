import { NamedError } from "@ax-code/util/error"
import { MessageV2 } from "./message-v2"

/**
 * Transient-error taxonomy for the compaction model fallback (C9), modeled on
 * Codex's `compact_model_fallback.rs`. Only error classes that may succeed
 * with a different model retry down the compaction ladder: server overload,
 * response stream disconnect/timeout, and internal server errors (5xx).
 * Invalid requests (4xx auth/validation) and context-window-exceeded are
 * request-shape problems that no model switch fixes, so they never retry.
 */
export namespace CompactionFallback {
  export type FailureClass =
    | "server_overloaded"
    | "stream_disconnect"
    | "internal_server_error"
    | "invalid_request"
    | "context_window_exceeded"
    | "unknown"

  export type Classification = {
    class: FailureClass
    retryable: boolean
  }

  /** Total attempts per compaction, including the first try (i.e. one retry). */
  export const MAX_ATTEMPTS = 2

  // Mirrors the transient network/stream markers in MessageV2.fromError and
  // SessionRetry: mid-stream interruptions and socket-level failures are the
  // disconnect/timeout class.
  const STREAM_PATTERNS = [
    "socket hang up",
    "network error",
    "network request failed",
    "sse read timed out",
    "stream ended without finish event",
    "stream stalled",
    "fetch failed",
    "connection terminated",
    "connection reset",
    "timed out",
    "econnreset",
    "etimedout",
    "econnrefused",
    "enotfound",
    "epipe",
    "eai_again",
  ]

  const OVERLOAD_PATTERNS = ["overloaded", "too many requests", "rate limit"]

  function matches(text: string | undefined, patterns: string[]) {
    if (!text) return false
    const lower = text.toLowerCase()
    return patterns.some((pattern) => lower.includes(pattern))
  }

  function dataMessage(error: { data?: unknown }): string | undefined {
    const data = error.data
    if (data && typeof data === "object" && typeof (data as { message?: unknown }).message === "string") {
      return (data as { message: string }).message
    }
    return undefined
  }

  /** Classify a recorded assistant-message error into the C9 taxonomy. */
  export function classify(error: NonNullable<MessageV2.Assistant["error"]>): Classification {
    if (MessageV2.ContextOverflowError.isInstance(error)) {
      return { class: "context_window_exceeded", retryable: false }
    }
    if (MessageV2.AuthError.isInstance(error)) {
      return { class: "invalid_request", retryable: false }
    }
    if (MessageV2.APIError.isInstance(error)) {
      const statusCode = error.data?.statusCode
      const message = error.data?.message
      const responseBody = error.data?.responseBody
      if (statusCode === 429 || matches(message, OVERLOAD_PATTERNS) || matches(responseBody, OVERLOAD_PATTERNS)) {
        return { class: "server_overloaded", retryable: true }
      }
      if (statusCode !== undefined && statusCode >= 500) {
        return { class: "internal_server_error", retryable: true }
      }
      // 4xx auth/validation failures are request-shape problems; switching
      // models does not change the outcome.
      if (statusCode !== undefined && statusCode >= 400) {
        return { class: "invalid_request", retryable: false }
      }
      if (matches(message, STREAM_PATTERNS) || matches(responseBody, STREAM_PATTERNS)) {
        return { class: "stream_disconnect", retryable: true }
      }
      return { class: "unknown", retryable: false }
    }
    if (matches(dataMessage(error), STREAM_PATTERNS)) {
      return { class: "stream_disconnect", retryable: true }
    }
    return { class: "unknown", retryable: false }
  }

  /**
   * Persist the C9 retry metadata on the recorded error itself. Only error
   * shapes whose schema carries an optional `metadata` record are annotated —
   * the `Assistant.error` union is re-validated on write, so writing to other
   * shapes would be stripped silently. Retryable classifications can only
   * occur for `APIError` (status/message paths) or the `data.message` shapes
   * below (stream-pattern fallback), and all of them now carry `metadata`.
   */
  export function annotate(
    error: NonNullable<MessageV2.Assistant["error"]>,
    fields: { retryAttempt: number; failureClass: FailureClass },
  ) {
    if (
      !MessageV2.APIError.isInstance(error) &&
      !MessageV2.AbortedError.isInstance(error) &&
      !MessageV2.OutputLoopError.isInstance(error) &&
      !MessageV2.StructuredOutputError.isInstance(error) &&
      !NamedError.Unknown.isInstance(error)
    ) {
      return
    }
    const data = error.data as { metadata?: Record<string, string> }
    data.metadata = {
      ...data.metadata,
      retryAttempt: String(fields.retryAttempt),
      failureClass: fields.failureClass,
    }
  }
}
