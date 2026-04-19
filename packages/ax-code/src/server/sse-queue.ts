import { AsyncQueue } from "@/util/queue"

export const SSE_SOFT_MAX = 1024
export const SSE_HARD_MAX = 4096

export type SseEnqueueResult = "queued" | "dropped" | "overflow"

export function pushSseFrame(queue: AsyncQueue<string | null>, payload: unknown): SseEnqueueResult {
  if (queue.size >= SSE_HARD_MAX) return "overflow"
  if (queue.size >= SSE_SOFT_MAX) return "dropped"
  queue.push(JSON.stringify(payload))
  return "queued"
}
