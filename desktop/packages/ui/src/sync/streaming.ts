/**
 * Streaming lifecycle tracking.
 *
 * Derives streaming state from the sync child store's session_status and
 * message/part updates. Components read this to know which messages are
 * currently streaming and their lifecycle phase.
 */

import { create } from "zustand"
import type { Message, SessionStatus } from "@ax-code/sdk/v2/client"
import type { State } from "./types"
import type { StreamPhase } from "@/types/streaming"

export type MessageStreamState = {
  phase: StreamPhase
  startedAt: number
  lastUpdateAt: number
  completedAt?: number
}

export type StreamingStore = {
  /** Currently streaming message per session */
  streamingMessageIds: Map<string, string | null>
  /** Lifecycle phase per message */
  messageStreamStates: Map<string, MessageStreamState>
  /** Sessions currently in prefill phase (busy, no assistant message yet) */
  prefillSessionIds: Set<string>
}

export const useStreamingStore = create<StreamingStore>()(() => ({
  streamingMessageIds: new Map(),
  messageStreamStates: new Map(),
  prefillSessionIds: new Set(),
}))

/**
 * Called from the SyncBridge/flush handler when child store state changes.
 * Derives streaming state from session_status + messages.
 */
/** Only update lastUpdateAt every this many ms to avoid 60Hz store churn */
const STREAMING_HEARTBEAT_MS = 1000

/** Drop completed stream states this long after completion to bound the map */
const COMPLETED_RETENTION_MS = 60_000

export function updateStreamingState(state: State) {
  const now = Date.now()
  const currentStore = useStreamingStore.getState()
  const currentStreamingIds = currentStore.streamingMessageIds
  const currentStreamStates = currentStore.messageStreamStates
  const currentPrefillIds = currentStore.prefillSessionIds

  const nextStreamingIds = new Map<string, string | null>()
  const nextStreamStates = new Map(currentStreamStates)
  const nextPrefillIds = new Set<string>()
  let changed = false

  // Fast path: only scan sessions that are actually busy.
  // Idle sessions are handled by checking against currentStreamingIds below.
  const busySessionIds = new Set<string>()
  for (const [sessionID, status] of Object.entries(state.session_status ?? {})) {
    if ((status as SessionStatus).type === "busy") {
      busySessionIds.add(sessionID)
    }
  }

  const completeStreamingMessage = (sessionID: string, msgId: string) => {
    nextStreamingIds.set(sessionID, null)
    nextPrefillIds.delete(sessionID)
    const existing = nextStreamStates.get(msgId)
    if (existing && (existing.phase === "streaming" || existing.phase === "prefill")) {
      nextStreamStates.set(msgId, {
        ...existing,
        phase: "completed",
        completedAt: now,
      })
    }
    changed = true
  }

  for (const sessionID of busySessionIds) {
    const messages = state.message[sessionID]
    if (!messages || messages.length === 0) {
      // Session is busy but has no messages yet — mark as prefill.
      // nextPrefillIds is rebuilt from scratch each tick, so always re-add a
      // still-prefilling session; only flag `changed` when it's newly added.
      // (Adding only when absent would drop it whenever an unrelated change
      // causes the store to be rewritten on the same tick.)
      nextPrefillIds.add(sessionID)
      if (!currentPrefillIds.has(sessionID)) {
        changed = true
      }
      continue
    }

    // Only the trailing assistant turn can be streaming. If a new user turn is
    // last, the next assistant message has not arrived yet.
    let streamingMsg: Message | null = null
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        break
      }
      if (messages[i].role === "assistant") {
        streamingMsg = messages[i]
        break
      }
    }

    if (!streamingMsg) {
      // No assistant message yet — session is in prefill phase
      nextPrefillIds.add(sessionID)
      const prevId = currentStreamingIds.get(sessionID)
      if (prevId) {
        completeStreamingMessage(sessionID, prevId)
      }
      continue
    }

    // Assistant message found — transition from prefill to streaming
    nextPrefillIds.delete(sessionID)
    if (currentPrefillIds.has(sessionID)) {
      changed = true
    }

    const prevId = currentStreamingIds.get(sessionID)
    if (prevId !== streamingMsg.id) changed = true
    nextStreamingIds.set(sessionID, streamingMsg.id)

    const existing = nextStreamStates.get(streamingMsg.id)
    if (!existing || (existing.phase !== "streaming" && existing.phase !== "prefill")) {
      nextStreamStates.set(streamingMsg.id, {
        phase: "streaming",
        startedAt: existing?.startedAt ?? now,
        lastUpdateAt: now,
      })
      changed = true
    } else if (existing.phase === "prefill") {
      // Transition from prefill to streaming
      nextStreamStates.set(streamingMsg.id, {
        ...existing,
        phase: "streaming",
        lastUpdateAt: now,
      })
      changed = true
    } else if (now - existing.lastUpdateAt >= STREAMING_HEARTBEAT_MS) {
      // Throttle lastUpdateAt writes to ~1Hz instead of 60Hz
      nextStreamStates.set(streamingMsg.id, {
        ...existing,
        lastUpdateAt: now,
      })
      changed = true
    }
  }

  // Mark completed any previously streaming sessions that are now idle or gone
  for (const [sessionID, msgId] of currentStreamingIds) {
    if (!msgId) continue
    const isStillBusy = busySessionIds.has(sessionID)
    if (isStillBusy) continue

    completeStreamingMessage(sessionID, msgId)
  }

  // Prune long-completed entries so messageStreamStates does not grow unbounded
  // over a session with many messages. Once a message finished streaming more
  // than COMPLETED_RETENTION_MS ago it no longer needs lifecycle tracking;
  // selectors fall back to null, which is correct for a settled message.
  for (const [msgId, streamState] of nextStreamStates) {
    if (
      streamState.phase === "completed" &&
      streamState.completedAt !== undefined &&
      now - streamState.completedAt > COMPLETED_RETENTION_MS
    ) {
      nextStreamStates.delete(msgId)
      changed = true
    }
  }

  if (changed) {
    useStreamingStore.setState({
      streamingMessageIds: nextStreamingIds,
      messageStreamStates: nextStreamStates,
      prefillSessionIds: nextPrefillIds,
    })
  }
}

// Selectors
export const selectStreamingMessageId = (sessionID: string) => (state: StreamingStore) =>
  state.streamingMessageIds.get(sessionID) ?? null

export const selectMessageStreamState = (messageID: string) => (state: StreamingStore) =>
  state.messageStreamStates.get(messageID) ?? null

export const selectIsStreaming = (sessionID: string) => (state: StreamingStore) =>
  state.streamingMessageIds.get(sessionID) != null

export const selectIsPrefilling = (sessionID: string) => (state: StreamingStore) =>
  state.prefillSessionIds.has(sessionID)
