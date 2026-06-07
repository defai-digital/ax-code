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
  shouldDrainOnIdle,
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

// Client-only "edit" channel: the sidebar asks the prompt composer (which owns
// the textarea ref) to load a queued follow-up's text back for editing. The
// composer removes the item from the queue only once the text actually lands,
// so a dropped request never loses the message. A new object each request
// retriggers the prompt's consuming effect.
const [editRequest, setEditRequest] = createSignal<{ sessionID: string; id: string; text: string } | undefined>()

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

/**
 * Forget all client state for a session that no longer exists (deleted/forked
 * away). Prevents the queue, drain baseline, and abort marks from leaking — and
 * stops a recreated id from inheriting a stale baseline and mis-draining.
 */
export function forgetFollowUpSession(sessionID: string): void {
  clearFollowUpQueue(sessionID)
  previousStatusBySession.delete(sessionID)
  abortAt.delete(sessionID)
}

export function markFollowUpAbort(sessionID: string, now: number = Date.now()): void {
  abortAt.set(sessionID, now)
}

export function hasRecentFollowUpAbort(sessionID: string, now: number = Date.now()): boolean {
  const at = abortAt.get(sessionID)
  return at !== undefined && now - at < RECENT_ABORT_WINDOW_MS
}

/** Ask the prompt composer to load a queued item's `text` for editing (sidebar edit control). */
export function requestFollowUpEdit(sessionID: string, id: string, text: string): void {
  setEditRequest({ sessionID, id, text })
}

/** Reactive accessor for a pending edit request — consumed by the prompt composer. */
export function followUpEditRequest(): { sessionID: string; id: string; text: string } | undefined {
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
 * Returns `true` when the item was dispatched — it is removed from the queue
 * here, while the in-flight guard is still held, so there is no window in which
 * another caller can re-dispatch the same head. Returns `false` when skipped
 * because another dispatch for the same session is already in flight (caller
 * leaves it queued, no error). A real server/transport failure throws (the item
 * stays queued) so callers can surface it — distinguishing a harmless skip from
 * an actual failure.
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
    removeQueuedFollowUp(sessionID, item.id)
    return true
  } finally {
    inflight.delete(sessionID)
  }
}

// Previous status per session, shared across every mounted Prompt instance so
// the global drain dedupes: the first instance to observe a transition handles
// it and updates the baseline; the rest see the new baseline and skip.
const previousStatusBySession = new Map<string, string>()

/**
 * Drain the head follow-up of any session that just transitioned busy/retry ->
 * idle. `snapshot` is `[sessionID, statusType]` for every known session. Safe to
 * call from several Prompt instances (see `previousStatusBySession`); failures
 * are reported via `onError` and leave the item queued.
 */
export function reconcileFollowUpDrain(
  sdk: SdkContext,
  snapshot: ReadonlyArray<readonly [string, string]>,
  onError?: (sessionID: string, error: unknown) => void,
): void {
  for (const [sessionID, currentType] of snapshot) {
    const previous = previousStatusBySession.get(sessionID)
    if (previous === undefined) {
      previousStatusBySession.set(sessionID, currentType)
      continue
    }
    if (!shouldDrainOnIdle(previous, currentType)) {
      previousStatusBySession.set(sessionID, currentType)
      continue
    }
    // busy/retry -> idle edge. If a dispatch for this session is already in
    // flight (e.g. a manual send-now), do NOT consume the edge: keep the
    // baseline so the next status change retries, rather than stranding the
    // head with no future transition to drain it.
    const head = headFollowUp(queues[sessionID])
    if (head && !hasRecentFollowUpAbort(sessionID) && inflight.has(sessionID)) continue
    previousStatusBySession.set(sessionID, currentType)
    if (!head) continue
    if (hasRecentFollowUpAbort(sessionID)) continue
    void dispatchFollowUp(sdk, sessionID, head).catch((error) => onError?.(sessionID, error))
  }
}

/** Test-only: reset the global drain baseline so cases don't bleed into each other. */
export function resetFollowUpDrainState(): void {
  previousStatusBySession.clear()
}
