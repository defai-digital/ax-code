/**
 * Reactive singleton store + server dispatch for the TUI interactive follow-up
 * queue (ADR-028). The queue is ephemeral (in-memory, lost on TUI restart),
 * client-owned, and per-session — matching the shipped ax-code-desktop model
 * and Codex CLI. Pure reducers/decisions live in `follow-up-queue.ts`.
 */
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

type SdkContext = ReturnType<typeof useSDK>
type PromptAsyncBody = Parameters<SdkContext["client"]["session"]["promptAsync"]>[0]

/**
 * Dispatch a single follow-up to the server via the normal async prompt route.
 * Concurrent dispatches for the same session are skipped (returns false). The
 * caller removes the item from the queue when this resolves true.
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
    if (result && typeof result === "object" && "error" in result && (result as { error?: unknown }).error) {
      return false
    }
    return true
  } finally {
    inflight.delete(sessionID)
  }
}
