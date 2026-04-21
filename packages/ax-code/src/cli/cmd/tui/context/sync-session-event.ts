export type SessionSyncEvent<
  TSession extends { id: string },
  TTodo,
  TDiff,
  TStatus,
> =
  | { type: "todo.updated"; properties: { sessionID: string; todos: TTodo[] } }
  | { type: "session.diff"; properties: { sessionID: string; diff: TDiff[] } }
  | { type: "session.deleted"; properties: { info: { id: string } } }
  | { type: "session.created"; properties: { info: TSession } }
  | { type: "session.updated"; properties: { info: TSession } }
  | { type: "session.status"; properties: { sessionID: string; status: TStatus } }

export interface SessionSyncEventHandlers<
  TSession extends { id: string },
  TTodo,
  TDiff,
  TStatus,
> {
  setTodo: (sessionID: string, todos: TTodo[]) => void
  setSessionDiff: (sessionID: string, diff: TDiff[]) => void
  setSessionStatus: (sessionID: string, status: TStatus) => void
  deleteSession: (sessionID: string) => void
  upsertSession: (session: TSession) => void
  clearSessionSyncState: (sessionID: string) => void
}

export function handleSessionSyncEvent<
  TSession extends { id: string },
  TTodo,
  TDiff,
  TStatus,
>(
  event: SessionSyncEvent<TSession, TTodo, TDiff, TStatus>,
  handlers: SessionSyncEventHandlers<TSession, TTodo, TDiff, TStatus>,
) {
  switch (event.type) {
    case "todo.updated":
      handlers.setTodo(event.properties.sessionID, event.properties.todos)
      return true

    case "session.diff":
      handlers.setSessionDiff(event.properties.sessionID, event.properties.diff)
      return true

    case "session.deleted": {
      const sessionID = event.properties.info.id
      handlers.clearSessionSyncState(sessionID)
      handlers.deleteSession(sessionID)
      return true
    }

    case "session.created":
    case "session.updated":
      handlers.upsertSession(event.properties.info)
      return true

    case "session.status":
      handlers.setSessionStatus(event.properties.sessionID, event.properties.status)
      return true
  }
}
