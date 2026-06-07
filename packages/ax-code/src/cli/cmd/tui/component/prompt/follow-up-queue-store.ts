/**
 * Reactive singleton store + server dispatch for the TUI interactive follow-up
 * queue (ADR-028). The queue is ephemeral (in-memory, lost on TUI restart),
 * client-owned, and per-session — matching the shipped ax-code-desktop model
 * and Codex CLI. Pure reducers/decisions live in `follow-up-queue.ts`.
 */
import { createSignal } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { MessageID } from "@/session/schema"
import type { useSDK } from "@tui/context/sdk"
import {
  appendFollowUp,
  headFollowUp,
  makeFollowUp,
  removeFollowUp,
  type FollowUpInput,
  type QueuedFollowUp,
} from "./follow-up-queue"

/** Window after a user interrupt during which we suppress auto-draining. */
const RECENT_ABORT_WINDOW_MS = 2000

const [queues, setQueues] = createStore<Record<string, QueuedFollowUp[]>>({})
// Guards against two drains (e.g. idle effect + manual send-now) racing the same
// session, which would double-dispatch the head item.
const inflight = new Set<string>()
const abortAt = new Map<string, number>()
let counter = 0

// Client-only "edit" channel: the sidebar removes a queued follow-up and asks
// the prompt composer (which owns the textarea ref) to load its text back for
// editing. A new object each request retriggers the prompt's consuming effect.
const [editRequest, setEditRequest] = createSignal<{ sessionID: string; text: string } | undefined>()

/** Reactive accessor — read inside a tracking scope to subscribe to changes. */
export function followUpQueue(sessionID: string): QueuedFollowUp[] {
  return queues[sessionID] ?? []
}

export function enqueueFollowUp(sessionID: string, input: FollowUpInput): QueuedFollowUp {
  counter += 1
  const item = makeFollowUp(input, `followup-${Date.now()}-${counter}`, Date.now())
  setQueues(
    produce((draft) => {
      draft[sessionID] = appendFollowUp(draft[sessionID], item)
    }),
  )
  return item
}

export function removeQueuedFollowUp(sessionID: string, id: string): void {
  setQueues(
    produce((draft) => {
      if (draft[sessionID]) draft[sessionID] = removeFollowUp(draft[sessionID], id)
    }),
  )
}

export function peekQueuedFollowUp(sessionID: string): QueuedFollowUp | undefined {
  return headFollowUp(queues[sessionID])
}

export function clearFollowUpQueue(sessionID: string): void {
  setQueues(
    produce((draft) => {
      delete draft[sessionID]
    }),
  )
}

export function markFollowUpAbort(sessionID: string, now: number = Date.now()): void {
  abortAt.set(sessionID, now)
}

export function hasRecentFollowUpAbort(sessionID: string, now: number = Date.now()): boolean {
  const at = abortAt.get(sessionID)
  return at !== undefined && now - at < RECENT_ABORT_WINDOW_MS
}

/** Ask the prompt composer to load `text` for editing (see sidebar edit control). */
export function requestFollowUpEdit(sessionID: string, text: string): void {
  setEditRequest({ sessionID, text })
}

/** Reactive accessor for a pending edit request — consumed by the prompt composer. */
export function followUpEditRequest(): { sessionID: string; text: string } | undefined {
  return editRequest()
}

export function clearFollowUpEdit(): void {
  setEditRequest(undefined)
}

type SdkContext = ReturnType<typeof useSDK>
type PromptAsyncBody = Parameters<SdkContext["client"]["session"]["promptAsync"]>[0]

/**
 * Dispatch a single follow-up to the server via the normal async prompt route.
 *
 * Returns `true` when the item was dispatched (caller removes it from the queue)
 * and `false` when the dispatch was skipped because another dispatch for the
 * same session is already in flight (caller leaves it queued, no error). A real
 * server/transport failure throws so callers can surface it — distinguishing a
 * harmless skip from an actual failure.
 */
export async function dispatchFollowUp(sdk: SdkContext, sessionID: string, item: QueuedFollowUp): Promise<boolean> {
  if (inflight.has(sessionID)) return false
  inflight.add(sessionID)
  try {
    const result = await sdk.client.session.promptAsync({
      sessionID,
      messageID: MessageID.ascending(),
      agent: item.agent,
      model: item.model,
      variant: item.variant,
      parts: item.parts as PromptAsyncBody["parts"],
    })
    const error = result && typeof result === "object" ? (result as { error?: unknown }).error : undefined
    if (error) {
      const detail = (error as { data?: { message?: string }; message?: string })?.data?.message
      throw new Error(detail ?? (error as { message?: string })?.message ?? "prompt_async failed")
    }
    return true
  } finally {
    inflight.delete(sessionID)
  }
}
