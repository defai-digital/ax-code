import { appendTextPartDelta, removeByID, shiftOverflow, upsert } from "./sync-util"

export function applyAskedRequest<T extends { id: string; sessionID: string }>(
  store: Record<string, T[]>,
  request: T,
) {
  const list = store[request.sessionID]
  if (!list) {
    store[request.sessionID] = [request]
    return
  }
  upsert(list, request)
}

export function applyResolvedRequest<T extends { id: string }>(
  store: Record<string, T[]>,
  sessionID: string,
  requestID: string,
) {
  const list = store[sessionID]
  if (!list) return
  return removeByID(list, requestID)
}

export function applyMessageUpdate<T extends { id: string }>(
  store: Record<string, T[]>,
  sessionID: string,
  message: T,
  maxSize: number,
) {
  const list = store[sessionID]
  if (!list) {
    store[sessionID] = [message]
    return
  }
  upsert(list, message)
  return shiftOverflow(list, maxSize)
}

export function applyMessageUpdateCleanup<
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
  const trimmed = applyMessageUpdate(store.message, sessionID, message, maxSize)
  if (trimmed) {
    delete store.part[trimmed.id]
  }
  return trimmed
}

export function applyMessageRemove<T extends { id: string }>(
  store: Record<string, T[]>,
  sessionID: string,
  messageID: string,
) {
  const list = store[sessionID]
  if (!list) return
  return removeByID(list, messageID)
}

export function applyMessageDeleteCleanup<
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
  const removed = applyMessageRemove(store.message, sessionID, messageID)
  delete store.part[removed?.id ?? messageID]
  return removed
}

export function applyPartUpdate<T extends { id: string }>(store: Record<string, T[]>, messageID: string, part: T) {
  const list = store[messageID]
  if (!list) {
    store[messageID] = [part]
    return
  }
  upsert(list, part)
}

export function applyPartDelta<T extends { id: string; type?: string; text?: string }>(
  store: Record<string, T[]>,
  messageID: string,
  partID: string,
  delta: string,
) {
  const list = store[messageID]
  if (!list) return false
  return appendTextPartDelta(list, partID, delta)
}

export function applyPartRemove<T extends { id: string }>(store: Record<string, T[]>, messageID: string, partID: string) {
  const list = store[messageID]
  if (!list) return
  return removeByID(list, partID)
}
