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

export function encodeSsePayload(payload: unknown): string {
  const seen = new WeakSet<object>()
  try {
    return (
      JSON.stringify(payload, (_key, value) => {
        if (typeof value === "bigint") return value.toString()
        if (typeof value === "object" && value !== null) {
          if (seen.has(value)) return "[Circular]"
          seen.add(value)
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
