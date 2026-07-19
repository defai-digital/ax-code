import { mergeSorted, removeByID, upsert } from "./sync-util"

export interface SyncedMessageParts<TMessage, TPart> {
  info: TMessage
  parts: TPart[]
}

export function createSessionSyncSnapshot<TSession, TTodo, TMessage, TPart, TDiff, TRisk, TGoal>(input: {
  session: TSession | undefined
  todo: TTodo[] | undefined
  messages: Array<SyncedMessageParts<TMessage, TPart>> | undefined
  diff: TDiff[] | undefined
  risk?: TRisk
  goal?: TGoal | null
}) {
  if (!input.session) return
  // A malformed (non-array) payload, or entries missing `info`, would pass the
  // `?? []` fallback and then crash `applySessionSyncSnapshot` (`.map`,
  // `message.info.id`). Coerce to renderable entries here.
  const messages = (Array.isArray(input.messages) ? input.messages : []).flatMap((message) => {
    if (!message || typeof message !== "object") return []
    const info = (message as { info?: unknown }).info
    if (!info || typeof info !== "object" || typeof (info as { id?: unknown }).id !== "string") return []
    const parts = (message as { parts?: unknown }).parts
    return [{ info: info as TMessage, parts: Array.isArray(parts) ? (parts as TPart[]) : [] }]
  })
  return {
    session: input.session,
    todo: Array.isArray(input.todo) ? input.todo : [],
    messages,
    diff: Array.isArray(input.diff) ? input.diff : [],
    risk: input.risk,
    goal: input.goal,
  }
}

export function applySessionSyncSnapshot<
  TSession extends { id: string },
  TTodo,
  TMessage extends { id: string },
  TPart,
  TDiff,
  TRisk,
  TGoal,
>(
  store: {
    session: TSession[]
    todo: Record<string, TTodo[]>
    message: Record<string, TMessage[]>
    part: Record<string, TPart[]>
    session_diff: Record<string, TDiff[]>
    session_risk: Record<string, TRisk>
    session_goal: Record<string, TGoal | null>
  },
  sessionID: string,
  snapshot: {
    session: TSession
    todo: TTodo[]
    messages: Array<SyncedMessageParts<TMessage, TPart>>
    diff: TDiff[]
    risk?: TRisk
    goal?: TGoal | null
  },
) {
  upsert(store.session, snapshot.session)

  const existingMessages = store.message[sessionID] ?? []
  const previousMessageIDs = new Set(existingMessages.map((message) => message.id))
  const nextMessages = snapshot.messages.map((message) => message.info)
  const snapshotMessageIDs = new Set(nextMessages.map((message) => message.id))
  const lastSnapshotMatchIndex = existingMessages.reduce((index, message, currentIndex) => {
    return snapshotMessageIDs.has(message.id) ? currentIndex : index
  }, -1)
  const liveTail =
    lastSnapshotMatchIndex >= 0
      ? existingMessages.slice(lastSnapshotMatchIndex + 1).filter((message) => !snapshotMessageIDs.has(message.id))
      : existingMessages.filter((message) => !snapshotMessageIDs.has(message.id))
  const mergedMessages = mergeSorted(nextMessages, liveTail)
  const nextMessageIDs = new Set(mergedMessages.map((message) => message.id))

  store.todo[sessionID] = snapshot.todo
  store.message[sessionID] = mergedMessages
  if (snapshot.risk !== undefined) store.session_risk[sessionID] = snapshot.risk
  for (const messageID of previousMessageIDs) {
    if (!nextMessageIDs.has(messageID)) {
      delete store.part[messageID]
    }
  }
  for (const message of snapshot.messages) {
    store.part[message.info.id] = message.parts
  }
  store.session_diff[sessionID] = snapshot.diff
  if (snapshot.goal !== undefined) store.session_goal[sessionID] = snapshot.goal
}

/**
 * Patch sidebar enrichment only. Used after a progressive core transcript
 * apply so the full snapshot cannot clobber live stream part deltas that
 * landed between core paint and enrichment RPC completion.
 */
export function applySessionSyncEnrichment<TDiff, TRisk, TGoal>(
  store: {
    session_diff: Record<string, TDiff[]>
    session_risk: Record<string, TRisk>
    session_goal: Record<string, TGoal | null>
  },
  sessionID: string,
  enrichment: {
    diff?: TDiff[]
    risk?: TRisk
    goal?: TGoal | null
  },
) {
  if (enrichment.diff !== undefined) store.session_diff[sessionID] = enrichment.diff
  if (enrichment.risk !== undefined) store.session_risk[sessionID] = enrichment.risk
  if (enrichment.goal !== undefined) store.session_goal[sessionID] = enrichment.goal
}

export function applySessionDeleteCleanup<
  TSession extends { id: string },
  TPermission,
  TQuestion,
  TStatus,
  TTodo,
  TMessage extends { id: string },
  TPart,
  TDiff,
  TRisk,
  TGoal,
>(
  store: {
    session: TSession[]
    permission: Record<string, TPermission[]>
    question: Record<string, TQuestion[]>
    session_status: Record<string, TStatus>
    session_risk: Record<string, TRisk>
    session_goal: Record<string, TGoal | null>
    session_diff: Record<string, TDiff[]>
    todo: Record<string, TTodo[]>
    message: Record<string, TMessage[]>
    part: Record<string, TPart[]>
  },
  sessionID: string,
) {
  removeByID(store.session, sessionID)

  const removedMessages = store.message[sessionID] ?? []
  for (const message of removedMessages) {
    delete store.part[message.id]
  }

  delete store.permission[sessionID]
  delete store.question[sessionID]
  delete store.session_status[sessionID]
  delete store.session_risk[sessionID]
  delete store.session_goal[sessionID]
  delete store.session_diff[sessionID]
  delete store.todo[sessionID]
  delete store.message[sessionID]
}

/**
 * Drop heavy transcript projection for a session the user just left, without
 * removing the session list row or in-flight permission/question/status.
 * Re-entry reloads heavy fields via the normal session sync path (ADR-047 D3).
 */
export function applySessionLeavePrune<TMessage extends { id: string }, TPart, TDiff, TRisk, TGoal, TTodo>(
  store: {
    session_risk: Record<string, TRisk>
    session_goal: Record<string, TGoal | null>
    session_diff: Record<string, TDiff[]>
    todo: Record<string, TTodo[]>
    message: Record<string, TMessage[]>
    part: Record<string, TPart[]>
  },
  sessionID: string,
) {
  const removedMessages = store.message[sessionID] ?? []
  for (const message of removedMessages) {
    delete store.part[message.id]
  }

  delete store.session_risk[sessionID]
  delete store.session_goal[sessionID]
  delete store.session_diff[sessionID]
  delete store.todo[sessionID]
  delete store.message[sessionID]
}

/**
 * Remove session-keyed projection for IDs that are no longer in the session
 * list (bootstrap reconcile / deleted sessions). Prevents SyncStore Records
 * from growing unboundedly across long TUI runs that open many conversations
 * (STAB-03 / UI-01).
 *
 * Bags are optional so partial store shapes (e.g. bootstrap assembly typing)
 * are safe; missing fields are skipped.
 */
export function pruneOrphanSessionRecords(store: {
  session: Array<{ id: string }>
  permission?: Record<string, unknown>
  question?: Record<string, unknown>
  session_status?: Record<string, unknown>
  session_error?: Record<string, unknown>
  session_risk?: Record<string, unknown>
  session_goal?: Record<string, unknown>
  session_diff?: Record<string, unknown>
  todo?: Record<string, unknown>
  message?: Record<string, Array<{ id: string }>>
  part?: Record<string, unknown>
}) {
  const live = new Set(store.session.map((session) => session.id))
  const bags: Array<Record<string, unknown> | undefined> = [
    store.permission,
    store.question,
    store.session_status,
    store.session_error,
    store.session_risk,
    store.session_goal,
    store.session_diff,
    store.todo,
    store.message,
  ]

  for (const bag of bags) {
    if (!bag) continue
    for (const id of Object.keys(bag)) {
      if (live.has(id)) continue
      if (bag === store.message && store.part) {
        const removedMessages = store.message?.[id] ?? []
        for (const message of removedMessages) {
          delete store.part[message.id]
        }
      }
      delete bag[id]
    }
  }
}
