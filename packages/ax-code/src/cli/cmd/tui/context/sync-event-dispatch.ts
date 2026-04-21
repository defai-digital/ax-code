import { upsert } from "./sync-util"
import {
  applyAskedRequest,
  applyMessageDeleteCleanup,
  applyMessageUpdateCleanup,
  applyPartDelta,
  applyPartRemove,
  applyPartUpdate,
  applyResolvedRequest,
} from "./sync-event-store"
import { applySessionDeleteCleanup } from "./sync-session-store"

export function applySessionUpsertEvent<T extends { id: string }>(sessions: T[], session: T) {
  upsert(sessions, session)
}

export function applySessionDeleteEvent<
  TSession extends { id: string },
  TPermission,
  TQuestion,
  TStatus,
  TTodo,
  TMessage extends { id: string },
  TPart,
  TDiff,
  TRisk = unknown,
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
  applySessionDeleteCleanup(store, sessionID)
}

export function applyMessageUpdateEvent<
  TMessage extends { id: string },
  TPart,
>(
  store: {
    message: Record<string, TMessage[]>
    part: Record<string, TPart[]>
  },
  sessionID: string,
  message: TMessage,
  maxSize: number,
) {
  applyMessageUpdateCleanup(store, sessionID, message, maxSize)
}

export function applyMessageDeleteEvent<
  TMessage extends { id: string },
  TPart,
>(
  store: {
    message: Record<string, TMessage[]>
    part: Record<string, TPart[]>
  },
  sessionID: string,
  messageID: string,
) {
  applyMessageDeleteCleanup(store, sessionID, messageID)
}

export function applyRequestResolvedEvent<T extends { id: string }>(
  store: Record<string, T[]>,
  sessionID: string,
  requestID: string,
) {
  applyResolvedRequest(store, sessionID, requestID)
}

export function applyRequestAskedEvent<T extends { id: string; sessionID: string }>(
  store: Record<string, T[]>,
  request: T,
) {
  applyAskedRequest(store, request)
}

export function applyPartUpdateEvent<TPart extends { id: string }>(
  store: Record<string, TPart[]>,
  messageID: string,
  part: TPart,
) {
  applyPartUpdate(store, messageID, part)
}

export function applyPartDeltaEvent<TPart extends { id: string; type?: string; text?: string }>(
  store: Record<string, TPart[]>,
  messageID: string,
  partID: string,
  delta: string,
) {
  return applyPartDelta(store, messageID, partID, delta)
}

export function applyPartDeleteEvent<TPart extends { id: string }>(
  store: Record<string, TPart[]>,
  messageID: string,
  partID: string,
) {
  return applyPartRemove(store, messageID, partID)
}
