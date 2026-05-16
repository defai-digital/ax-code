import { createSessionSyncSnapshot, type SyncedMessageParts } from "./sync-session-store"

export interface SessionSyncFetchResult<T> {
  data: T | undefined
}

export interface SessionSyncSnapshotLoader<TSession, TTodo, TMessage, TPart, TDiff, TRisk> {
  sessionID: string
  timeoutMs: number
  withTimeout: <T>(label: string, promise: Promise<T>, timeoutMs: number) => Promise<T>
  fetchSession: () => Promise<SessionSyncFetchResult<TSession>>
  fetchMessages: () => Promise<SessionSyncFetchResult<Array<SyncedMessageParts<TMessage, TPart>>>>
  fetchTodo: () => Promise<SessionSyncFetchResult<TTodo[]>>
  fetchDiff: () => Promise<SessionSyncFetchResult<TDiff[]>>
  fetchRisk?: () => Promise<SessionSyncFetchResult<TRisk>>
}

export async function fetchSessionSyncSnapshot<TSession, TTodo, TMessage, TPart, TDiff, TRisk = unknown>(
  input: SessionSyncSnapshotLoader<TSession, TTodo, TMessage, TPart, TDiff, TRisk>,
) {
  const [session, messages, todo, diff, risk] = await Promise.all([
    input.withTimeout(`tui session sync ${input.sessionID} session.get`, input.fetchSession(), input.timeoutMs),
    input.withTimeout(`tui session sync ${input.sessionID} session.messages`, input.fetchMessages(), input.timeoutMs),
    input.withTimeout(`tui session sync ${input.sessionID} session.todo`, input.fetchTodo(), input.timeoutMs),
    input.withTimeout(`tui session sync ${input.sessionID} session.diff`, input.fetchDiff(), input.timeoutMs),
    input.fetchRisk
      ? input
          .withTimeout(`tui session sync ${input.sessionID} session.risk`, input.fetchRisk(), input.timeoutMs)
          .catch(() => undefined)
      : Promise.resolve(undefined),
  ])

  return createSessionSyncSnapshot({
    session: session.data,
    todo: todo.data,
    messages: messages.data,
    diff: diff.data,
    risk: risk?.data,
  })
}
