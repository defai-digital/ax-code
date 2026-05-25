import { AsyncQueue } from "@/util/queue"

export const SSE_HARD_MAX = 4096

export type SseEnqueueResult = "queued" | "overflow"

export function pushSseFrame(queue: AsyncQueue<string | null>, payload: unknown): SseEnqueueResult {
  if (queue.size >= SSE_HARD_MAX) return "overflow"
  queue.push(JSON.stringify(payload))
  return "queued"
}
