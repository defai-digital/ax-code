import { produce, type SetStoreFunction } from "solid-js/store"
import { createSessionSyncController } from "./sync-session-coordinator"
import { fetchSessionSyncSnapshot, type SessionSyncFetchResult } from "./sync-session-fetch"
import {
  applySessionSyncEnrichment,
  applySessionSyncSnapshot,
  createSessionSyncSnapshot,
  type SyncedMessageParts,
} from "./sync-session-store"

export interface SessionSyncStoreState<
  TSession extends { id: string },
  TTodo,
  TMessage extends { id: string },
  TPart,
  TDiff,
  TRisk,
  TGoal,
> {
  session: TSession[]
  todo: Record<string, TTodo[]>
  message: Record<string, TMessage[]>
  part: Record<string, TPart[]>
  session_diff: Record<string, TDiff[]>
  session_risk: Record<string, TRisk>
  session_goal: Record<string, TGoal | null>
}

type SessionSyncSnapshot<
  TSession,
  TTodo,
  TMessage,
  TPart,
  TDiff,
  TRisk,
  TGoal,
> = NonNullable<ReturnType<typeof createSessionSyncSnapshot<TSession, TTodo, TMessage, TPart, TDiff, TRisk, TGoal>>>

export function createStoreBackedSessionSyncController<
  TSession extends { id: string },
  TTodo,
  TMessage extends { id: string },
  TPart,
  TDiff,
  TRisk,
  TGoal,
  TStore extends SessionSyncStoreState<TSession, TTodo, TMessage, TPart, TDiff, TRisk, TGoal>,
>(input: {
  timeoutMs: number
  withTimeout: <T>(label: string, promise: Promise<T>, timeoutMs: number) => Promise<T>
  setStore: SetStoreFunction<TStore>
  fetchSession: (sessionID: string) => Promise<SessionSyncFetchResult<TSession>>
  fetchMessages: (sessionID: string) => Promise<SessionSyncFetchResult<Array<SyncedMessageParts<TMessage, TPart>>>>
  fetchTodo: (sessionID: string) => Promise<SessionSyncFetchResult<TTodo[]>>
  fetchDiff: (sessionID: string) => Promise<SessionSyncFetchResult<TDiff[]>>
  fetchRisk?: (sessionID: string) => Promise<SessionSyncFetchResult<TRisk>>
  fetchGoal?: (sessionID: string) => Promise<SessionSyncFetchResult<TGoal | null>>
  onMissingSnapshot?: (sessionID: string) => void
}) {
  const setStore = input.setStore as unknown as SetStoreFunction<
    SessionSyncStoreState<TSession, TTodo, TMessage, TPart, TDiff, TRisk, TGoal>
  >

  type Snapshot = SessionSyncSnapshot<TSession, TTodo, TMessage, TPart, TDiff, TRisk, TGoal>

  return createSessionSyncController<Snapshot>({
    async fetchSnapshot(sessionID, options) {
      return fetchSessionSyncSnapshot<TSession, TTodo, TMessage, TPart, TDiff, TRisk, TGoal>({
        sessionID,
        timeoutMs: input.timeoutMs,
        withTimeout: input.withTimeout,
        fetchSession: () => input.fetchSession(sessionID),
        fetchMessages: () => input.fetchMessages(sessionID),
        fetchTodo: () => input.fetchTodo(sessionID),
        fetchDiff: () => input.fetchDiff(sessionID),
        fetchRisk: input.fetchRisk ? () => input.fetchRisk!(sessionID) : undefined,
        fetchGoal: input.fetchGoal ? () => input.fetchGoal!(sessionID) : undefined,
        onCoreReady: options?.onCoreReady,
      })
    },
    applySnapshot(sessionID, snapshot, mode = "full") {
      setStore(
        produce((draft) => {
          if (mode === "enrichment") {
            applySessionSyncEnrichment(draft, sessionID, {
              diff: snapshot.diff,
              risk: snapshot.risk,
              goal: snapshot.goal,
            })
            return
          }
          applySessionSyncSnapshot(draft, sessionID, snapshot)
        }),
      )
    },
    onMissingSnapshot: input.onMissingSnapshot,
  })
}
