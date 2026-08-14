import {
  dispatchStoreBackedSyncEvent,
  type DispatchStoreBackedSyncEventInput,
  type SyncEventStoreState,
} from "./sync-store-event"
import type { SyncEvent } from "./sync-event"
import { toErrorMessage } from "@/util/error-message"
import { createStreamDeltaCoalescer, type StreamEventLike } from "../util/coalesce-stream-events"

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
  // When true, autonomous permission/question requests are auto-replied even
  // in the TUI (Super-Long runs unsupervised); plain autonomous keeps
  // interactive supervision.
  getAutoReplyRequests?: () => boolean
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
  syncWorkflowDashboard?: DispatchStoreBackedSyncEventInput<
    TSession,
    TTodo,
    TDiff,
    TStatus,
    TMessage,
    TPart,
    TStore
  >["syncWorkflowDashboard"]
  scheduleRuntimeProbe?: DispatchStoreBackedSyncEventInput<
    TSession,
    TTodo,
    TDiff,
    TStatus,
    TMessage,
    TPart,
    TStore
  >["scheduleRuntimeProbe"]
  bootstrap: DispatchStoreBackedSyncEventInput<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TStore>["bootstrap"]
  refreshProviders?: DispatchStoreBackedSyncEventInput<
    TSession,
    TTodo,
    TDiff,
    TStatus,
    TMessage,
    TPart,
    TStore
  >["refreshProviders"]
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
  // Reactive batching boundary (Solid `batch`) injected by the caller so this
  // module stays framework-free per the TUI layering guardrails.
  batch?: (fn: () => void) => void
  dispatch?: (
    input: DispatchStoreBackedSyncEventInput<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TStore>,
  ) => boolean
}) {
  const dispatch = input.dispatch ?? dispatchStoreBackedSyncEvent

  const applyEvent = (event: SyncEvent<TSession, TTodo, TDiff, TStatus, TMessage, TPart>) => {
    dispatch({
      event,
      autonomous: input.getAutonomous(),
      autoReplyRequests: input.getAutoReplyRequests?.(),
      setStore: input.setStore,
      clearSessionSyncState: input.clearSessionSyncState,
      replyPermission: input.replyPermission,
      replyQuestion: input.replyQuestion,
      syncMcpStatus: input.syncMcpStatus,
      syncLspStatus: input.syncLspStatus,
      syncDebugEngine: input.syncDebugEngine,
      syncWorkflowDashboard: input.syncWorkflowDashboard,
      scheduleRuntimeProbe: input.scheduleRuntimeProbe,
      bootstrap: input.bootstrap,
      refreshProviders: input.refreshProviders,
      onWarn: input.onWarn,
      maxSessionMessages: input.maxSessionMessages,
    })
  }

  // Coalesce high-frequency text deltas (~token stream) so the Solid store
  // projection pays once per frame window instead of once per token — cuts
  // full-frame TUI flicker while streaming (#376).
  const coalescer = createStreamDeltaCoalescer({
    emit(events) {
      // One reactive batch per flush window: without it each event's store
      // projection runs its own synchronous propagation pass, so a window
      // carrying delta + status + todo updates pays N render trees.
      const run = input.batch ?? ((fn: () => void) => fn())
      run(() => {
        for (const event of events) {
          try {
            applyEvent(event as SyncEvent<TSession, TTodo, TDiff, TStatus, TMessage, TPart>)
          } catch (error) {
            input.onHandlerError({
              type: eventType(event),
              error: toErrorMessage(error),
            })
          }
        }
      })
    },
  })

  const unsubscribe = input.listen((envelope) => {
    try {
      coalescer.push(envelope.details as StreamEventLike)
    } catch (error) {
      input.onHandlerError({
        type: eventType(envelope.details),
        error: toErrorMessage(error),
      })
    }
  })

  return () => {
    coalescer.dispose()
    unsubscribe()
  }
}
