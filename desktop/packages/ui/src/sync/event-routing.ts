import type { Event, Message, Part } from "@ax-code/sdk/v2/client"
import type { Session } from "@ax-code/sdk/v2"
import type { ChildStoreManager } from "./child-store"
import type { State } from "./types"

// ---------------------------------------------------------------------------
// Event routing — resolves which directory child store an SSE event belongs
// to, and maintains a lightweight index (session → directory, message →
// session) so resolution stays O(1) in the steady state. Pure functions over
// explicit parameters; all state lives in the EventRoutingIndex maps.
// ---------------------------------------------------------------------------

export const EMPTY_MESSAGES: Message[] = []

export type EventRoutingIndex = {
  sessionDirectoryById: Map<string, string>
  messageSessionById: Map<string, string>
  sessionMessageIdsById: Map<string, Set<string>>
}

export const createEventRoutingIndex = (): EventRoutingIndex => ({
  sessionDirectoryById: new Map(),
  messageSessionById: new Map(),
  sessionMessageIdsById: new Map(),
})

export const normalizeEventDirectory = (rawDirectory: string): string => {
  if (!rawDirectory || rawDirectory === "global") {
    return rawDirectory
  }
  const normalized = rawDirectory.replace(/\\/g, "/").replace(/^([a-z]):/, (_, l: string) => l.toUpperCase() + ":")
  // Strip trailing slashes to match child store keys (normalizeDirectoryPath in useDirectoryStore)
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized
}

export const getSessionIdFromPayload = (event: Event): string | null => {
  const properties = (event as { properties?: unknown }).properties
  if (!properties || typeof properties !== "object") {
    return null
  }

  const props = properties as Record<string, unknown>

  if (event.type === "message.updated") {
    const info = props.info
    if (!info || typeof info !== "object") {
      return null
    }
    const sessionID = (info as { sessionID?: unknown }).sessionID
    return typeof sessionID === "string" && sessionID.length > 0 ? sessionID : null
  }

  if (
    event.type === "message.removed" ||
    event.type === "session.status" ||
    event.type === "todo.updated" ||
    event.type === "permission.asked" ||
    event.type === "permission.replied" ||
    event.type === "question.asked" ||
    event.type === "question.replied" ||
    event.type === "question.rejected" ||
    event.type === "session.deleted"
  ) {
    const sessionID = props.sessionID
    return typeof sessionID === "string" && sessionID.length > 0 ? sessionID : null
  }

  if (event.type === "message.part.updated") {
    const part = props.part
    if (!part || typeof part !== "object") {
      return null
    }
    const sessionID = (part as { sessionID?: unknown }).sessionID
    return typeof sessionID === "string" && sessionID.length > 0 ? sessionID : null
  }

  if (event.type === "session.created" || event.type === "session.updated") {
    const info = props.info
    if (!info || typeof info !== "object") {
      return null
    }
    const id = (info as { id?: unknown }).id
    return typeof id === "string" && id.length > 0 ? id : null
  }

  return null
}

export const getMessageIdFromPayload = (event: Event): string | null => {
  const properties = (event as { properties?: unknown }).properties
  if (!properties || typeof properties !== "object") {
    return null
  }

  const props = properties as Record<string, unknown>

  if (event.type === "message.updated") {
    const info = props.info
    if (!info || typeof info !== "object") {
      return null
    }
    const id = (info as { id?: unknown }).id
    return typeof id === "string" && id.length > 0 ? id : null
  }

  if (
    event.type === "message.removed" ||
    event.type === "message.part.delta" ||
    event.type === "message.part.removed"
  ) {
    const messageID = props.messageID
    return typeof messageID === "string" && messageID.length > 0 ? messageID : null
  }

  if (event.type === "message.part.updated") {
    const part = props.part
    if (!part || typeof part !== "object") {
      return null
    }
    const messageID = (part as { messageID?: unknown }).messageID
    return typeof messageID === "string" && messageID.length > 0 ? messageID : null
  }

  return null
}

export const setIndexedSessionDirectory = (routingIndex: EventRoutingIndex, sessionID: string, directory: string) => {
  if (!sessionID || !directory || directory === "global") {
    return
  }
  routingIndex.sessionDirectoryById.set(sessionID, directory)
}

export const setIndexedSessionMessages = (
  routingIndex: EventRoutingIndex,
  sessionID: string,
  directory: string,
  messages: Message[],
) => {
  if (!sessionID) {
    return
  }

  setIndexedSessionDirectory(routingIndex, sessionID, directory)

  const previous = routingIndex.sessionMessageIdsById.get(sessionID)
  const next = new Set<string>()

  for (const message of messages) {
    if (!message?.id) {
      continue
    }
    next.add(message.id)
    routingIndex.messageSessionById.set(message.id, sessionID)
  }

  if (previous) {
    for (const previousMessageID of previous) {
      if (!next.has(previousMessageID)) {
        routingIndex.messageSessionById.delete(previousMessageID)
      }
    }
  }

  routingIndex.sessionMessageIdsById.set(sessionID, next)
}

const setIndexedMessage = (
  routingIndex: EventRoutingIndex,
  sessionID: string,
  messageID: string,
  directory: string,
) => {
  if (!sessionID || !messageID) {
    return
  }

  setIndexedSessionDirectory(routingIndex, sessionID, directory)
  routingIndex.messageSessionById.set(messageID, sessionID)

  const existing = routingIndex.sessionMessageIdsById.get(sessionID)
  if (existing) {
    existing.add(messageID)
  } else {
    routingIndex.sessionMessageIdsById.set(sessionID, new Set([messageID]))
  }
}

const removeIndexedMessage = (routingIndex: EventRoutingIndex, messageID: string, sessionHint?: string | null) => {
  if (!messageID) {
    return
  }

  const sessionID = sessionHint ?? routingIndex.messageSessionById.get(messageID)
  routingIndex.messageSessionById.delete(messageID)

  if (!sessionID) {
    return
  }

  const messageIds = routingIndex.sessionMessageIdsById.get(sessionID)
  if (!messageIds) {
    return
  }

  messageIds.delete(messageID)
  if (messageIds.size === 0) {
    routingIndex.sessionMessageIdsById.delete(sessionID)
  }
}

const removeIndexedSession = (routingIndex: EventRoutingIndex, sessionID: string) => {
  if (!sessionID) {
    return
  }

  routingIndex.sessionDirectoryById.delete(sessionID)
  const messageIds = routingIndex.sessionMessageIdsById.get(sessionID)
  if (messageIds) {
    for (const messageID of messageIds) {
      routingIndex.messageSessionById.delete(messageID)
    }
  }
  routingIndex.sessionMessageIdsById.delete(sessionID)
}

export const ingestDirectoryStateIntoRoutingIndex = (routingIndex: EventRoutingIndex, directory: string, state: State) => {
  const nextSessionIds = new Set<string>()

  for (const session of state.session) {
    if (!session?.id) {
      continue
    }
    nextSessionIds.add(session.id)
    setIndexedSessionDirectory(routingIndex, session.id, directory)
  }

  for (const sessionID of Object.keys(state.message)) {
    nextSessionIds.add(sessionID)
    setIndexedSessionDirectory(routingIndex, sessionID, directory)
    setIndexedSessionMessages(routingIndex, sessionID, directory, state.message[sessionID] ?? EMPTY_MESSAGES)
  }

  for (const [indexedSessionID, indexedDirectory] of routingIndex.sessionDirectoryById) {
    if (indexedDirectory !== directory) {
      continue
    }
    if (!nextSessionIds.has(indexedSessionID)) {
      removeIndexedSession(routingIndex, indexedSessionID)
    }
  }
}

export const findSessionInChildStores = (
  sessionID: string,
  childStores: ChildStoreManager,
  routingIndex: EventRoutingIndex,
): string | null => {
  for (const [dir, store] of childStores.children) {
    const state = store.getState()
    if (
      state.session.some((s) => s.id === sessionID) ||
      Object.prototype.hasOwnProperty.call(state.message, sessionID) ||
      Object.prototype.hasOwnProperty.call(state.session_status ?? {}, sessionID)
    ) {
      // Self-heal: populate the routing index so future events resolve instantly
      setIndexedSessionDirectory(routingIndex, sessionID, dir)
      return dir
    }
  }
  return null
}

const childStoreHasSessionState = (childStores: ChildStoreManager, directory: string, sessionID: string): boolean => {
  const store = childStores.getChild(directory)
  if (!store) return false
  const state = store.getState()
  return (
    state.session.some((session) => session.id === sessionID) ||
    Object.prototype.hasOwnProperty.call(state.message, sessionID) ||
    Object.prototype.hasOwnProperty.call(state.session_status ?? {}, sessionID)
  )
}

const childStoreHasMessagePartState = (
  childStores: ChildStoreManager,
  directory: string,
  messageID: string,
): boolean => {
  const store = childStores.getChild(directory)
  if (!store) return false
  return Object.prototype.hasOwnProperty.call(store.getState().part, messageID)
}

export const resolveDirectoryFromRoutingIndex = (
  routingIndex: EventRoutingIndex,
  rawDirectory: string,
  payload: Event,
  childStores: ChildStoreManager,
): string => {
  const normalizedDirectory = normalizeEventDirectory(rawDirectory)

  const sessionID = getSessionIdFromPayload(payload)
  if (sessionID) {
    if (
      normalizedDirectory &&
      normalizedDirectory !== "global" &&
      childStoreHasSessionState(childStores, normalizedDirectory, sessionID)
    ) {
      setIndexedSessionDirectory(routingIndex, sessionID, normalizedDirectory)
      return normalizedDirectory
    }

    const indexedDirectory = routingIndex.sessionDirectoryById.get(sessionID)
    if (indexedDirectory && childStores.getChild(indexedDirectory)) {
      return indexedDirectory
    }

    // Routing index miss — scan child stores for this session.
    // Covers optimistic sessions not yet indexed and events with wrong/empty directory.
    const found = findSessionInChildStores(sessionID, childStores, routingIndex)
    if (found) {
      return found
    }
  }

  const messageID = getMessageIdFromPayload(payload)
  if (messageID) {
    if (
      normalizedDirectory &&
      normalizedDirectory !== "global" &&
      childStoreHasMessagePartState(childStores, normalizedDirectory, messageID)
    ) {
      return normalizedDirectory
    }

    const sessionFromMessage = routingIndex.messageSessionById.get(messageID)
    if (sessionFromMessage) {
      const indexedDirectory = routingIndex.sessionDirectoryById.get(sessionFromMessage)
      if (indexedDirectory && childStores.getChild(indexedDirectory)) {
        return indexedDirectory
      }
    }

    // Scan child stores for a store that has parts for this message
    for (const [dir, store] of childStores.children) {
      if (Object.prototype.hasOwnProperty.call(store.getState().part, messageID)) {
        return dir
      }
    }
  }

  // Single-store fallback: if there's only one directory, use it
  if (
    (sessionID || messageID) &&
    (!normalizedDirectory || normalizedDirectory === "global") &&
    childStores.children.size === 1
  ) {
    const onlyDirectory = childStores.children.keys().next().value
    if (typeof onlyDirectory === "string" && onlyDirectory.length > 0) {
      return onlyDirectory
    }
  }

  return normalizedDirectory
}

export const updateRoutingIndexFromEvent = (routingIndex: EventRoutingIndex, directory: string, payload: Event) => {
  if (!directory || directory === "global") {
    return
  }

  const sessionID = getSessionIdFromPayload(payload)
  if (sessionID) {
    setIndexedSessionDirectory(routingIndex, sessionID, directory)
  }

  switch (payload.type) {
    case "session.created":
    case "session.updated": {
      const info = (payload.properties as { info?: Session }).info
      if (info?.id) {
        setIndexedSessionDirectory(routingIndex, info.id, directory)
      }
      return
    }

    case "session.deleted": {
      const deletedSessionID = (payload.properties as { sessionID?: string }).sessionID
      if (deletedSessionID) {
        removeIndexedSession(routingIndex, deletedSessionID)
      }
      return
    }

    case "message.updated": {
      const info = (payload.properties as { info?: Message }).info
      if (info?.id && info.sessionID) {
        setIndexedMessage(routingIndex, info.sessionID, info.id, directory)
      }
      return
    }

    case "message.removed": {
      const props = payload.properties as { sessionID?: string; messageID?: string }
      if (props.messageID) {
        removeIndexedMessage(routingIndex, props.messageID, props.sessionID)
      }
      return
    }

    case "message.part.updated": {
      const part = (payload.properties as { part?: Part }).part as
        | (Part & { sessionID?: string; messageID?: string })
        | undefined
      if (part?.messageID && part.sessionID) {
        setIndexedMessage(routingIndex, part.sessionID, part.messageID, directory)
      }
      return
    }

    default:
      return
  }
}
