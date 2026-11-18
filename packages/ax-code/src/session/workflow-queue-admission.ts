import { asRecord } from "@ax-code/util/record"
import type { TaskQueue } from "./task-queue"

export const ACTIVE_QUEUE_EXECUTION_STATUSES = ["running", "blocked_permission", "blocked_question"] as const
export const WORKFLOW_PACING_WINDOW_MS = 60_000

type WorkflowPacing = { maxRequestsPerMinute: number; maxTokensPerMinute: number }

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined
}

export function workflowMaxParallel(payload: TaskQueue.Payload): number | undefined {
  return positiveInteger(payload["maxParallel"])
}

export function workflowPacing(payload: TaskQueue.Payload): WorkflowPacing | undefined {
  const pacing = asRecord(payload["pacing"])
  const maxRequestsPerMinute = positiveInteger(pacing.maxRequestsPerMinute)
  const maxTokensPerMinute = positiveInteger(pacing.maxTokensPerMinute)
  if (maxRequestsPerMinute === undefined || maxTokensPerMinute === undefined) return undefined
  return { maxRequestsPerMinute, maxTokensPerMinute }
}

function estimatedTokens(payload: TaskQueue.Payload): number {
  const budget = asRecord(payload["budgetSlice"])
  return (
    positiveInteger(budget.maxTotalTokens) ??
    (positiveInteger(budget.maxInputTokensPerChild) ?? 0) + (positiveInteger(budget.maxOutputTokensPerChild) ?? 0)
  )
}

export function workflowPacingDelay(
  recent: readonly TaskQueue.Info[],
  payload: TaskQueue.Payload,
  pacing: WorkflowPacing,
  now: number,
): number {
  const started = recent
    .flatMap(({ time, payload }) =>
      time.started === undefined ? [] : [{ at: time.started, tokens: estimatedTokens(payload) }],
    )
    .sort((left, right) => left.at - right.at)
  const waitUntilExpires = (at: number) => Math.max(1, at + WORKFLOW_PACING_WINDOW_MS - now)
  const requestWait = started.length >= pacing.maxRequestsPerMinute ? waitUntilExpires(started[0]!.at) : 0
  const requested = estimatedTokens(payload)
  // A request larger than the whole window could never become eligible by waiting.
  if (requested <= 0 || requested > pacing.maxTokensPerMinute) return requestWait
  let total = requested + started.reduce((sum, item) => sum + item.tokens, 0)
  if (total <= pacing.maxTokensPerMinute) return requestWait
  for (const item of started) {
    total -= item.tokens
    if (total <= pacing.maxTokensPerMinute) return Math.max(requestWait, waitUntilExpires(item.at))
  }
  return requestWait
}
