import { AsyncQueue } from "@/util/queue"
import { toErrorMessage } from "@/util/error-message"

/**
 * Hard maximum number of frames that can be queued before the connection
 * is terminated. This prevents unbounded memory growth when a client
 * cannot consume events fast enough.
 */
export const SSE_HARD_MAX = 4096

/**
 * Warning threshold - when queue size exceeds this, log a warning.
 * This provides early visibility into backpressure issues before
 * the hard limit triggers a disconnect.
 */
export const SSE_WARN_THRESHOLD = 3072

export type SseEnqueueResult = "queued" | "overflow" | "warning"

export interface SseQueueOptions {
  maxQueueSize?: number
  warnThreshold?: number
}

export function pushSseFrame(
  queue: AsyncQueue<string | null>,
  payload: unknown,
  options?: SseQueueOptions,
): SseEnqueueResult {
  const maxSize = options?.maxQueueSize ?? SSE_HARD_MAX
  const warnAt = options?.warnThreshold ?? SSE_WARN_THRESHOLD

  if (queue.size >= maxSize) return "overflow"

  queue.push(encodeSsePayload(payload))

  // Return warning status if we've crossed the warning threshold
  // but haven't hit the hard limit yet.
  if (queue.size >= warnAt) return "warning"

  return "queued"
}

/**
 * Encodes an SSE payload in two tiers: the fast path tries plain JSON.stringify first and only falls back to the
 * replacer path when that throws (circular structure, BigInt, or a throwing toJSON). The output is byte-identical
 * because the replacer only transforms values that make the fast path throw, so any payload the fast path accepts
 * passes through the replacer untouched.
 */
export function encodeSsePayload(payload: unknown): string {
  try {
    return JSON.stringify(payload) ?? "null"
  } catch {
    // Fall through to the replacer path below.
  }
  const ancestors: object[] = []
  try {
    return (
      JSON.stringify(payload, function (this: unknown, _key, value) {
        if (typeof value === "bigint") return value.toString()
        if (typeof value === "object" && value !== null) {
          // JSON.stringify revisits shared DAG nodes legitimately. Keep only
          // the active ancestor chain so a repeated sibling reference is
          // serialized normally and only a true cycle is replaced.
          while (ancestors.length > 0 && ancestors.at(-1) !== this) ancestors.pop()
          if (ancestors.includes(value)) return "[Circular]"
          ancestors.push(value)
        }
        return value
      }) ?? "null"
    )
  } catch (error) {
    return JSON.stringify({
      type: "server.serialization_error",
      properties: {
        error: toErrorMessage(error),
      },
    })
  }
}
