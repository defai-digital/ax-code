import { produce, type SetStoreFunction } from "solid-js/store"
import { createSessionSyncController } from "./sync-session-coordinator"
import { fetchSessionSyncSnapshot, type SessionSyncFetchResult } from "./sync-session-fetch"
import { applySessionSyncSnapshot, type SyncedMessageParts } from "./sync-session-store"

export interface SessionSyncStoreState<
  TSession extends { id: string },
  TTodo,
  TMessage extends { id: string },
  TPart,
  TDiff,
> {
  session: TSession[]
  todo: Record<string, TTodo[]>
  message: Record<string, TMessage[]>
  part: Record<string, TPart[]>
  session_diff: Record<string, TDiff[]>
}

export function createStoreBackedSessionSyncController<
  TSession extends { id: string },
  TTodo,
  TMessage extends { id: string },
  TPart,
  TDiff,
  TStore extends SessionSyncStoreState<TSession, TTodo, TMessage, TPart, TDiff>,
>(input: {
  timeoutMs: number
  withTimeout: <T>(label: string, promise: Promise<T>, timeoutMs: number) => Promise<T>
  setStore: SetStoreFunction<TStore>
  fetchSession: (sessionID: string) => Promise<SessionSyncFetchResult<TSession>>
  fetchMessages: (sessionID: string) => Promise<SessionSyncFetchResult<Array<SyncedMessageParts<TMessage, TPart>>>>
  fetchTodo: (sessionID: string) => Promise<SessionSyncFetchResult<TTodo[]>>
  fetchDiff: (sessionID: string) => Promise<SessionSyncFetchResult<TDiff[]>>
  onMissingSnapshot?: (sessionID: string) => void
}) {
  const setStore = input.setStore as unknown as SetStoreFunction<
    SessionSyncStoreState<TSession, TTodo, TMessage, TPart, TDiff>
  >

  return createSessionSyncController({
    async fetchSnapshot(sessionID) {
      return fetchSessionSyncSnapshot({
        sessionID,
        timeoutMs: input.timeoutMs,
        withTimeout: input.withTimeout,
        fetchSession: () => input.fetchSession(sessionID),
        fetchMessages: () => input.fetchMessages(sessionID),
        fetchTodo: () => input.fetchTodo(sessionID),
        fetchDiff: () => input.fetchDiff(sessionID),
      })
    },
    applySnapshot(sessionID, snapshot) {
      setStore(
        produce((draft) => {
          applySessionSyncSnapshot(draft, sessionID, snapshot)
        }),
      )
    },
    onMissingSnapshot: input.onMissingSnapshot,
  })
}
