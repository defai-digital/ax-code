import { mergeSorted, removeByID, upsert } from "./sync-util"

export interface SyncedMessageParts<TMessage, TPart> {
  info: TMessage
  parts: TPart[]
}

export function createSessionSyncSnapshot<
  TSession,
  TTodo,
  TMessage,
  TPart,
  TDiff,
  TRisk,
>(input: {
  session: TSession | undefined
  todo: TTodo[] | undefined
  messages: Array<SyncedMessageParts<TMessage, TPart>> | undefined
  diff: TDiff[] | undefined
  risk?: TRisk
}) {
  if (!input.session) return
  return {
    session: input.session,
    todo: input.todo ?? [],
    messages: input.messages ?? [],
    diff: input.diff ?? [],
    risk: input.risk,
  }
}

export function applySessionSyncSnapshot<
  TSession extends { id: string },
  TTodo,
  TMessage extends { id: string },
  TPart,
  TDiff,
  TRisk,
>(
  store: {
    session: TSession[]
    todo: Record<string, TTodo[]>
    message: Record<string, TMessage[]>
    part: Record<string, TPart[]>
    session_diff: Record<string, TDiff[]>
    session_risk: Record<string, TRisk>
  },
  sessionID: string,
  snapshot: {
    session: TSession
    todo: TTodo[]
    messages: Array<SyncedMessageParts<TMessage, TPart>>
    diff: TDiff[]
    risk?: TRisk
  },
) {
  upsert(store.session, snapshot.session)

  const existingMessages = store.message[sessionID] ?? []
  const previousMessageIDs = new Set(existingMessages.map((message) => message.id))
  const nextMessages = snapshot.messages.map((message) => message.info)
  const lastSnapshotMatchIndex = existingMessages.reduce((index, message, currentIndex) => {
    return nextMessages.some((next) => next.id === message.id) ? currentIndex : index
  }, -1)
  const liveTail =
    lastSnapshotMatchIndex >= 0
      ? existingMessages.slice(lastSnapshotMatchIndex + 1).filter((message) => !nextMessages.some((next) => next.id === message.id))
      : []
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
>(
  store: {
    session: TSession[]
    permission: Record<string, TPermission[]>
    question: Record<string, TQuestion[]>
    session_status: Record<string, TStatus>
    session_risk: Record<string, TRisk>
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
  delete store.session_diff[sessionID]
  delete store.todo[sessionID]
  delete store.message[sessionID]
}
