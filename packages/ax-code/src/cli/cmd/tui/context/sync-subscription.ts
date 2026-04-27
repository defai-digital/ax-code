import {
  dispatchStoreBackedSyncEvent,
  type DispatchStoreBackedSyncEventInput,
  type SyncEventStoreState,
} from "./sync-store-event"
import type { SyncEvent } from "./sync-event-router"

interface SyncEventEnvelope<TDetails = unknown> {
  details: TDetails
}

function eventType(details: unknown) {
  if (!details || typeof details !== "object") return
  if (!("type" in details)) return
  const value = (details as { type?: unknown }).type
  return typeof value === "string" ? value : undefined
}

export function subscribeStoreBackedSyncEvents<
  TSession extends { id: string },
  TTodo,
  TDiff,
  TStatus,
  TMessage extends { id: string; sessionID: string },
  TPart extends { id: string; messageID: string },
  TStore extends SyncEventStoreState<TSession, TTodo, TDiff, TStatus, TMessage, TPart>,
>(input: {
  listen: (handler: (event: SyncEventEnvelope<unknown>) => void) => () => void
  getAutonomous: () => boolean
  setStore: DispatchStoreBackedSyncEventInput<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TStore>["setStore"]
  clearSessionSyncState: DispatchStoreBackedSyncEventInput<
    TSession,
    TTodo,
    TDiff,
    TStatus,
    TMessage,
    TPart,
    TStore
  >["clearSessionSyncState"]
  replyPermission: DispatchStoreBackedSyncEventInput<
    TSession,
    TTodo,
    TDiff,
    TStatus,
    TMessage,
    TPart,
    TStore
  >["replyPermission"]
  replyQuestion: DispatchStoreBackedSyncEventInput<
    TSession,
    TTodo,
    TDiff,
    TStatus,
    TMessage,
    TPart,
    TStore
  >["replyQuestion"]
  syncMcpStatus: DispatchStoreBackedSyncEventInput<
    TSession,
    TTodo,
    TDiff,
    TStatus,
    TMessage,
    TPart,
    TStore
  >["syncMcpStatus"]
  syncLspStatus: DispatchStoreBackedSyncEventInput<
    TSession,
    TTodo,
    TDiff,
    TStatus,
    TMessage,
    TPart,
    TStore
  >["syncLspStatus"]
  syncDebugEngine: DispatchStoreBackedSyncEventInput<
    TSession,
    TTodo,
    TDiff,
    TStatus,
    TMessage,
    TPart,
    TStore
  >["syncDebugEngine"]
  bootstrap: DispatchStoreBackedSyncEventInput<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TStore>["bootstrap"]
  onWarn: DispatchStoreBackedSyncEventInput<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TStore>["onWarn"]
  maxSessionMessages: DispatchStoreBackedSyncEventInput<
    TSession,
    TTodo,
    TDiff,
    TStatus,
    TMessage,
    TPart,
    TStore
  >["maxSessionMessages"]
  onHandlerError: (input: { type: string | undefined; error: string }) => void
  dispatch?: (
    input: DispatchStoreBackedSyncEventInput<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TStore>,
  ) => boolean
}) {
  const dispatch = input.dispatch ?? dispatchStoreBackedSyncEvent

  return input.listen((envelope) => {
    try {
      dispatch({
        event: envelope.details as SyncEvent<TSession, TTodo, TDiff, TStatus, TMessage, TPart>,
        autonomous: input.getAutonomous(),
        setStore: input.setStore,
        clearSessionSyncState: input.clearSessionSyncState,
        replyPermission: input.replyPermission,
        replyQuestion: input.replyQuestion,
        syncMcpStatus: input.syncMcpStatus,
        syncLspStatus: input.syncLspStatus,
        syncDebugEngine: input.syncDebugEngine,
        bootstrap: input.bootstrap,
        onWarn: input.onWarn,
        maxSessionMessages: input.maxSessionMessages,
      })
    } catch (error) {
      input.onHandlerError({
        type: eventType(envelope.details),
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
}
