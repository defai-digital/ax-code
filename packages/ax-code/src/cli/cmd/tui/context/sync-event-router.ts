import { handleMessageSyncEvent, type MessageSyncEvent, type MessageSyncEventHandlers } from "./sync-message-event"
import { handleRequestSyncEvent, type RequestSyncEvent, type RequestSyncEventHandlers } from "./sync-request-event"
import { handleRuntimeSyncEvent, type RuntimeSyncEvent, type RuntimeSyncEventHandlers } from "./sync-runtime-event"
import { handleSessionSyncEvent, type SessionSyncEvent, type SessionSyncEventHandlers } from "./sync-session-event"

export type ControlSyncEvent = { type: "server.instance.disposed" }

export type SyncEvent<
  TSession extends { id: string },
  TTodo,
  TDiff,
  TStatus,
  TMessage extends { id: string; sessionID: string },
  TPart extends { id: string; messageID: string },
> =
  | RequestSyncEvent
  | SessionSyncEvent<TSession, TTodo, TDiff, TStatus>
  | MessageSyncEvent<TMessage, TPart>
  | RuntimeSyncEvent
  | ControlSyncEvent

export interface SyncEventRouterHandlers<
  TSession extends { id: string },
  TTodo,
  TDiff,
  TStatus,
  TMessage extends { id: string; sessionID: string },
  TPart extends { id: string; messageID: string },
> {
  request: RequestSyncEventHandlers
  session: SessionSyncEventHandlers<TSession, TTodo, TDiff, TStatus>
  message: MessageSyncEventHandlers<TMessage, TPart>
  runtime: RuntimeSyncEventHandlers
  bootstrap: () => Promise<void> | void
  onWarn: (label: string, error: unknown) => void
}

export function handleSyncEvent<
  TSession extends { id: string },
  TTodo,
  TDiff,
  TStatus,
  TMessage extends { id: string; sessionID: string },
  TPart extends { id: string; messageID: string },
>(
  event: SyncEvent<TSession, TTodo, TDiff, TStatus, TMessage, TPart>,
  handlers: SyncEventRouterHandlers<TSession, TTodo, TDiff, TStatus, TMessage, TPart>,
) {
  if (handleRequestSyncEvent(event as RequestSyncEvent, handlers.request)) return true
  if (handleSessionSyncEvent(event as SessionSyncEvent<TSession, TTodo, TDiff, TStatus>, handlers.session)) return true
  if (handleMessageSyncEvent(event as MessageSyncEvent<TMessage, TPart>, handlers.message)) return true
  if (event.type === "server.instance.disposed") {
    try {
      void Promise.resolve(handlers.bootstrap()).catch((error) => handlers.onWarn("bootstrap sync failed", error))
    } catch (error) {
      handlers.onWarn("bootstrap sync failed", error)
    }
    return true
  }
  if (handleRuntimeSyncEvent(event as RuntimeSyncEvent, handlers.runtime)) return true
  return false
}
