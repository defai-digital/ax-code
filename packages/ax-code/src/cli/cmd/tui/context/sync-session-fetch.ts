import { createSessionSyncSnapshot, type SyncedMessageParts } from "./sync-session-store"

export interface SessionSyncFetchResult<T> {
  data: T | undefined
}

export interface SessionSyncSnapshotLoader<
  TSession,
  TTodo,
  TMessage,
  TPart,
  TDiff,
> {
  sessionID: string
  timeoutMs: number
  withTimeout: <T>(label: string, promise: Promise<T>, timeoutMs: number) => Promise<T>
  fetchSession: () => Promise<SessionSyncFetchResult<TSession>>
  fetchMessages: () => Promise<SessionSyncFetchResult<Array<SyncedMessageParts<TMessage, TPart>>>>
  fetchTodo: () => Promise<SessionSyncFetchResult<TTodo[]>>
  fetchDiff: () => Promise<SessionSyncFetchResult<TDiff[]>>
}

export async function fetchSessionSyncSnapshot<
  TSession,
  TTodo,
  TMessage,
  TPart,
  TDiff,
>(input: SessionSyncSnapshotLoader<TSession, TTodo, TMessage, TPart, TDiff>) {
  const [session, messages, todo, diff] = await Promise.all([
    input.withTimeout(
      `tui session sync ${input.sessionID} session.get`,
      input.fetchSession(),
      input.timeoutMs,
    ),
    input.withTimeout(
      `tui session sync ${input.sessionID} session.messages`,
      input.fetchMessages(),
      input.timeoutMs,
    ),
    input.withTimeout(
      `tui session sync ${input.sessionID} session.todo`,
      input.fetchTodo(),
      input.timeoutMs,
    ),
    input.withTimeout(
      `tui session sync ${input.sessionID} session.diff`,
      input.fetchDiff(),
      input.timeoutMs,
    ),
  ])

  return createSessionSyncSnapshot({
    session: session.data,
    todo: todo.data,
    messages: messages.data,
    diff: diff.data,
  })
}
