import type { PermissionRequest, QuestionRequest } from "@ax-code/sdk/v2"
import { produce, type SetStoreFunction } from "solid-js/store"
import type { SyncedSessionRisk } from "./sync-session-risk"
import {
  applyMessageDeleteEvent,
  applyMessageUpdateEvent,
  applyPartDeleteEvent,
  applyPartDeltaEvent,
  applyPartUpdateEvent,
  applySessionDeleteEvent,
  applySessionUpsertEvent,
} from "./sync-event-dispatch"
import { handleSyncEvent, type SyncEvent } from "./sync-event-router"
import type { RequestSyncEventHandlers } from "./sync-request-event"
import type { RuntimeSyncEventHandlers } from "./sync-runtime-event"

export interface SyncEventStoreState<
  TSession extends { id: string },
  TTodo,
  TDiff,
  TStatus,
  TMessage extends { id: string; sessionID: string },
  TPart extends { id: string; messageID: string },
> {
  permission: Record<string, PermissionRequest[]>
  question: Record<string, QuestionRequest[]>
  todo: Record<string, TTodo[]>
  session_diff: Record<string, TDiff[]>
  session_status: Record<string, TStatus>
  session_risk: Record<string, SyncedSessionRisk>
  session: TSession[]
  message: Record<string, TMessage[]>
  part: Record<string, TPart[]>
  vcs: { branch: string } | undefined
}

export interface DispatchStoreBackedSyncEventInput<
  TSession extends { id: string },
  TTodo,
  TDiff,
  TStatus,
  TMessage extends { id: string; sessionID: string },
  TPart extends { id: string; messageID: string },
  TStore extends SyncEventStoreState<TSession, TTodo, TDiff, TStatus, TMessage, TPart>,
> {
  event: SyncEvent<TSession, TTodo, TDiff, TStatus, TMessage, TPart>
  autonomous: boolean
  setStore: SetStoreFunction<TStore>
  clearSessionSyncState: (sessionID: string) => void
  replyPermission: RequestSyncEventHandlers["replyPermission"]
  replyQuestion: RequestSyncEventHandlers["replyQuestion"]
  syncMcpStatus: RuntimeSyncEventHandlers["syncMcpStatus"]
  syncLspStatus: RuntimeSyncEventHandlers["syncLspStatus"]
  syncDebugEngine: RuntimeSyncEventHandlers["syncDebugEngine"]
  bootstrap: () => Promise<void> | void
  onWarn: (label: string, error: unknown) => void
  maxSessionMessages: number
}

export function dispatchStoreBackedSyncEvent<
  TSession extends { id: string },
  TTodo,
  TDiff,
  TStatus,
  TMessage extends { id: string; sessionID: string },
  TPart extends { id: string; messageID: string },
  TStore extends SyncEventStoreState<TSession, TTodo, TDiff, TStatus, TMessage, TPart>,
>(
  input: DispatchStoreBackedSyncEventInput<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TStore>,
) {
  const setStore = input.setStore as unknown as SetStoreFunction<
    SyncEventStoreState<TSession, TTodo, TDiff, TStatus, TMessage, TPart>
  >

  return handleSyncEvent(input.event, {
    request: {
      autonomous: input.autonomous,
      updatePermission(updater) {
        setStore("permission", produce(updater))
      },
      updateQuestion(updater) {
        setStore("question", produce(updater))
      },
      replyPermission(payload) {
        return input.replyPermission(payload)
      },
      replyQuestion(payload) {
        return input.replyQuestion(payload)
      },
      onWarn: input.onWarn,
    },
    session: {
      setTodo(sessionID, todos) {
        setStore("todo", sessionID, todos)
      },
      setSessionDiff(sessionID, diff) {
        setStore("session_diff", sessionID, diff)
      },
      setSessionStatus(sessionID, status) {
        setStore("session_status", sessionID, status)
      },
      clearSessionSyncState(sessionID) {
        input.clearSessionSyncState(sessionID)
      },
      deleteSession(sessionID) {
        setStore(
          produce((draft) => {
            applySessionDeleteEvent(draft, sessionID)
          }),
        )
      },
      upsertSession(session) {
        setStore(
          "session",
          produce((draft) => {
            applySessionUpsertEvent(draft, session)
          }),
        )
      },
    },
    message: {
      updateMessage(sessionID, message) {
        setStore(
          produce((draft) => {
            applyMessageUpdateEvent(draft, sessionID, message, input.maxSessionMessages)
          }),
        )
      },
      deleteMessage(sessionID, messageID) {
        setStore(
          produce((draft) => {
            applyMessageDeleteEvent(draft, sessionID, messageID)
          }),
        )
      },
      updatePart(messageID, part) {
        setStore(
          "part",
          produce((draft) => {
            applyPartUpdateEvent(draft, messageID, part)
          }),
        )
      },
      appendPartDelta(messageID, partID, delta) {
        setStore(
          "part",
          produce((draft) => {
            applyPartDeltaEvent(draft, messageID, partID, delta)
          }),
        )
      },
      deletePart(messageID, partID) {
        setStore(
          "part",
          produce((draft) => {
            applyPartDeleteEvent(draft, messageID, partID)
          }),
        )
      },
    },
    runtime: {
      syncMcpStatus: input.syncMcpStatus,
      syncLspStatus: input.syncLspStatus,
      syncDebugEngine: input.syncDebugEngine,
      setVcsBranch(branch) {
        setStore("vcs", { branch })
      },
      onWarn: input.onWarn,
    },
    bootstrap: input.bootstrap,
    onWarn: input.onWarn,
  })
}
