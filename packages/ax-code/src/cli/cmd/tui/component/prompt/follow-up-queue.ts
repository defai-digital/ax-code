/**
 * Pure logic for the TUI interactive follow-up queue (ADR-028).
 *
 * While a session is busy, plain prompts the user types are buffered in a
 * client-owned queue instead of being parked as durable `waiting_for_idle`
 * task-queue rows on the server. When the session goes idle the head of the
 * queue is replayed through the normal prompt route.
 *
 * This module holds the side-effect-free pieces (reducers + status decisions)
 * so they can be unit tested without SolidJS or a live server. The reactive
 * singleton store and the dispatch path live in `follow-up-queue-store.ts`.
 */

/** A prompt part as captured from the composer; shape mirrors the prompt body parts. */
export type FollowUpPart = { id?: string; type: string; text?: string; [key: string]: unknown }

export interface FollowUpInput {
  parts: FollowUpPart[]
  agent?: string
  model?: { providerID: string; modelID: string }
  variant?: string
}

export interface QueuedFollowUp extends FollowUpInput {
  id: string
  createdAt: number
}

export type SessionStatusType = "idle" | "busy" | "retry"

export function makeFollowUp(input: FollowUpInput, id: string, createdAt: number): QueuedFollowUp {
  return { ...input, id, createdAt }
}

export function appendFollowUp(list: readonly QueuedFollowUp[] | undefined, item: QueuedFollowUp): QueuedFollowUp[] {
  return [...(list ?? []), item]
}

export function removeFollowUp(list: readonly QueuedFollowUp[] | undefined, id: string): QueuedFollowUp[] {
  return (list ?? []).filter((item) => item.id !== id)
}

export function headFollowUp(list: readonly QueuedFollowUp[] | undefined): QueuedFollowUp | undefined {
  return (list ?? [])[0]
}

/** A session is busy enough to buffer follow-ups when it is not idle. */
export function isQueueableStatus(type: SessionStatusType | string | undefined): boolean {
  return type === "busy" || type === "retry"
}

/**
 * Drain the queue only on a real busy/retry -> idle transition. This mirrors the
 * desktop auto-send rule so follow-ups run exactly once when a turn finishes,
 * not on unrelated status churn.
 */
export function shouldDrainOnIdle(
  previous: SessionStatusType | string | undefined,
  current: SessionStatusType | string | undefined,
): boolean {
  return (previous === "busy" || previous === "retry") && current === "idle"
}

/** First non-empty text of a queued follow-up, used for display + tests. */
export function followUpText(item: QueuedFollowUp): string {
  for (const part of item.parts) {
    if (part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0) {
      return part.text.trim()
    }
  }
  return ""
}
