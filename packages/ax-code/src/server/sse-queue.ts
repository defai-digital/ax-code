import { AsyncQueue } from "@/util/queue"
import { toErrorMessage } from "@/util/error-message"

export const SSE_HARD_MAX = 4096

export type SseEnqueueResult = "queued" | "overflow"

export function pushSseFrame(
  queue: AsyncQueue<string | null>,
  payload: unknown,
  options?: { maxQueueSize?: number },
): SseEnqueueResult {
  if (queue.size >= (options?.maxQueueSize ?? SSE_HARD_MAX)) return "overflow"
  queue.push(encodeSsePayload(payload))
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
