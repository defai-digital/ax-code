/**
 * Steer-now delivery for saved follow-ups.
 *
 * The composer gesture (`input_submit_steer`, default ctrl+s) steers the typed
 * draft into the running generation; this module extends the same delivery to
 * follow-ups already saved in the durable queue. All mutation goes through the
 * atomic server endpoint `POST /task-queue/:id/steer` — never a client-side
 * pause/steer/cancel sequence, which would race the executor and the turn
 * boundary. When no generation is active the server leaves the row untouched
 * and the caller falls back to prioritizing it (front of the queue, starts
 * when the turn ends), with a toast that says exactly that.
 *
 * Queue promotion (ctrl+s with an empty composer) steers the steerable PREFIX
 * of the queue in FIFO order and stops at the first barrier — a paused,
 * blocked, running, or non-text row, an agent/variant/model override, or text
 * over the steering limit. Later rows never jump ahead of a barrier, so the
 * conversation keeps its causal order.
 */

import z from "zod"
import { directoryRequestHeaders } from "@tui/util/request-headers"
import { responseErrorMessage } from "@tui/util/error-message"
import { followUpBody, followUpAction, type DurableFollowUp, type FollowUpSdk } from "./durable-follow-up"

export const STEER_MAX_TEXT_LENGTH = 16_000

const SteerReceipt = z.object({
  status: z.enum(["accepted", "applied", "rejected"]),
  reason: z.string().optional(),
})
const SteerResponse = z.object({
  item: z.unknown(),
  receipt: SteerReceipt.nullable(),
  reason: z.string().optional(),
})

export type SteerFollowUpOutcome =
  | { kind: "delivered"; item: DurableFollowUp }
  | { kind: "queued_next"; item: DurableFollowUp }
  | { kind: "failed"; message: string }

/** Reasons that mean "no live generation to steer": prioritize the row instead. */
const FALLBACK_REASONS = new Set(["generation_not_active", "generation_ended_before_application"])

export type SteerBarrier = "paused" | "status" | "attachments" | "too_long" | "empty"

/**
 * Why a queue row cannot steer, or null when it can. Mirrors the server checks:
 * the row must be pending (not paused) and text-only within the steering size
 * limit. The body always snapshots the composer's agent/model/variant, which
 * steering intentionally ignores in favor of the running turn's context.
 */
export function steerBarrier(item: DurableFollowUp): SteerBarrier | null {
  if (item.status === "paused") return "paused"
  if (item.status !== "queued" && item.status !== "waiting_for_idle") return "status"
  let body: ReturnType<typeof followUpBody>
  try {
    body = followUpBody(item)
  } catch {
    return "empty"
  }
  if (body.parts.length !== 1 || body.parts[0]?.type !== "text") return "attachments"
  const text = body.parts[0]?.text?.trim() ?? ""
  if (!text) return "empty"
  if (text.length > STEER_MAX_TEXT_LENGTH) return "too_long"
  return null
}

export type SteerablePrefix = {
  items: DurableFollowUp[]
  barrier?: { item: DurableFollowUp; reason: SteerBarrier }
}

/**
 * The steerable prefix of the FIFO queue: every leading row that can steer, up
 * to (not past) the first barrier. Rows are expected pre-sorted the way
 * durableFollowUps() returns them.
 */
export function steerablePrefix(rows: readonly DurableFollowUp[]): SteerablePrefix {
  const items: DurableFollowUp[] = []
  for (const row of rows) {
    const reason = steerBarrier(row)
    if (reason) return { items, barrier: { item: row, reason } }
    items.push(row)
  }
  return { items }
}

/** Steer one saved follow-up via the atomic server endpoint. */
export async function steerFollowUp(
  sdk: FollowUpSdk,
  item: DurableFollowUp,
): Promise<SteerFollowUpOutcome> {
  if (!sdk.sseConnected) return { kind: "failed", message: "Reconnect before steering saved follow-ups" }
  const base = `${sdk.url.replace(/\/$/, "")}/task-queue/${encodeURIComponent(item.id)}`
  const headers = directoryRequestHeaders({ directory: sdk.directory, contentType: "application/json" })
  let parsed: z.infer<typeof SteerResponse>
  try {
    const response = await sdk.fetch(`${base}/steer`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) return { kind: "failed", message: await responseErrorMessage(response) }
    parsed = SteerResponse.parse(await response.json())
  } catch (error) {
    return { kind: "failed", message: error instanceof Error ? error.message : "Steering request failed" }
  }
  const receipt = parsed.receipt
  if (receipt && (receipt.status === "accepted" || receipt.status === "applied")) {
    return { kind: "delivered", item: parsed.item as DurableFollowUp }
  }
  const reason = receipt?.reason ?? parsed.reason ?? "rejected"
  if (FALLBACK_REASONS.has(reason)) {
    // The turn already ended (or never started): move the row to the front so
    // it runs next. This is prioritization, not mid-turn injection.
    try {
      const prioritized = await followUpAction(sdk, item.id, "send-now")
      return { kind: "queued_next", item: prioritized }
    } catch (error) {
      return { kind: "failed", message: error instanceof Error ? error.message : "Follow-up action failed" }
    }
  }
  return { kind: "failed", message: reason }
}

export type SteerQueueOutcome = {
  steered: DurableFollowUp[]
  queuedNext: DurableFollowUp[]
  remaining: number
  failed?: string
  barrier?: SteerablePrefix["barrier"]
}

/**
 * Steer the queue's steerable prefix in FIFO order, stopping at the first
 * failure or barrier so later rows never jump ahead. When the generation is
 * gone the first miss is prioritized and the rest are left to drain in order —
 * prioritizing every row would reverse them (each send-now lands at position 0).
 */
export async function steerQueuedPrefix(
  sdk: FollowUpSdk,
  rows: readonly DurableFollowUp[],
): Promise<SteerQueueOutcome> {
  const prefix = steerablePrefix(rows)
  const outcome: SteerQueueOutcome = {
    steered: [],
    queuedNext: [],
    remaining: rows.length,
    barrier: prefix.barrier,
  }
  for (const item of prefix.items) {
    const result = await steerFollowUp(sdk, item)
    if (result.kind === "delivered") {
      outcome.steered.push(result.item)
      continue
    }
    if (result.kind === "queued_next") {
      outcome.queuedNext.push(result.item)
      break
    }
    outcome.failed = result.message
    break
  }
  outcome.remaining = rows.length - outcome.steered.length - outcome.queuedNext.length
  return outcome
}
