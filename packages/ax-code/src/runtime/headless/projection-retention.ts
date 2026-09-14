/** Reconstructible transcript budgets, separate from authoritative session storage. */
export const MAX_TRANSCRIPT_BYTES = 16 * 1024 * 1024
export const MAX_PENDING_MESSAGES = 128
export const MAX_PENDING_BYTES = 1024 * 1024

type State = {
  message: Record<string, Array<{ id: string }>>
  part: Record<string, unknown[]>
  message_truncated?: Record<string, boolean>
  message_memory_limited?: Record<string, boolean>
  message_reload?: Record<string, boolean>
}
type Size = { sessionID?: string; info: number; parts: Map<string, number> }
type Ledger = {
  sizes: Map<string, Size>
  pending: Set<string>
  floor: Map<string, string>
  delta: Map<string, Map<string, string>>
}
const ledgers = new WeakMap<object, Ledger>()
function ledger(state: State) {
  let value = ledgers.get(state.part)
  if (!value) {
    value = { sizes: new Map(), pending: new Set(), floor: new Map(), delta: new Map() }
    ledgers.set(state.part, value)
  }
  return value
}
function bytes(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8")
}
function sizeTotal(size: Size) {
  let total = size.info
  for (const value of size.parts.values()) total += value
  return total
}
function owner(state: State, messageID: string, explicit?: string) {
  return (
    explicit ??
    ledger(state).sizes.get(messageID)?.sessionID ??
    Object.entries(state.message).find(([, messages]) => messages.some((message) => message.id === messageID))?.[0]
  )
}
function sizeEntry(state: State, messageID: string, sessionID?: string) {
  const book = ledger(state)
  let entry = book.sizes.get(messageID)
  if (!entry) {
    entry = { sessionID, info: 0, parts: new Map() }
    book.sizes.set(messageID, entry)
  }
  entry.sessionID ??= sessionID
  return entry
}
export function rememberProjectionMessage(state: State, message: { id: string; sessionID: string }) {
  sizeEntry(state, message.id, message.sessionID).info = bytes(message)
  ledger(state).pending.delete(message.id)
}
export function admitsProjectionPart(state: State, part: { messageID: string; sessionID?: string }) {
  const sessionID = owner(state, part.messageID, part.sessionID)
  if (!sessionID) return true
  if (state.message[sessionID]?.some((message) => message.id === part.messageID)) return true
  const floor = ledger(state).floor.get(sessionID)
  return !floor || part.messageID > floor
}
export function rememberProjectionPart(state: State, part: { id: string; messageID: string; sessionID?: string }) {
  const sessionID = owner(state, part.messageID, part.sessionID)
  sizeEntry(state, part.messageID, sessionID).parts.set(part.id, bytes(part))
  if (!sessionID || !state.message[sessionID]?.some((message) => message.id === part.messageID)) {
    ledger(state).pending.add(part.messageID)
  }
  boundPending(state)
}
export function rememberProjectionDelta(
  state: State,
  messageID: string,
  partID: string,
  suffix: string,
  previousTail: string,
) {
  const size = ledger(state).sizes.get(messageID)
  if (size?.parts.has(partID))
    size.parts.set(partID, size.parts.get(partID)! + bytes(previousTail + suffix) - bytes(previousTail))
  boundPending(state)
}
function boundPending(state: State) {
  const book = ledger(state)
  let total = 0
  for (const id of book.pending) total += sizeTotal(book.sizes.get(id)!)
  while (book.pending.size > MAX_PENDING_MESSAGES || total > MAX_PENDING_BYTES) {
    const id = book.pending.values().next().value
    if (!id) break
    const size = book.sizes.get(id)!
    total -= sizeTotal(size)
    if (size.sessionID) (state.message_reload ??= {})[size.sessionID] = true
    forgetProjectionMessage(state, id)
  }
}
export function forgetProjectionMessage(state: State, messageID: string, evictedSessionID?: string) {
  const book = ledger(state)
  if (evictedSessionID) {
    const previous = book.floor.get(evictedSessionID)
    if (!previous || messageID > previous) book.floor.set(evictedSessionID, messageID)
    if (state.message_truncated) state.message_truncated[evictedSessionID] = true
  }
  delete state.part[messageID]
  book.sizes.delete(messageID)
  book.pending.delete(messageID)
  book.delta.delete(messageID)
}
export function forgetProjectionPart(state: State, messageID: string, partID: string) {
  ledger(state).sizes.get(messageID)?.parts.delete(partID)
  clearProjectionDelta(state, messageID, partID)
}
export function clearProjectionSession(state: State, sessionID: string) {
  const book = ledger(state)
  const ids = new Set((state.message[sessionID] ?? []).map((message) => message.id))
  for (const [id, value] of book.sizes) if (value.sessionID === sessionID) ids.add(id)
  for (const [id, parts] of Object.entries(state.part)) {
    if (parts.some((part) => (part as { sessionID?: string })?.sessionID === sessionID)) ids.add(id)
  }
  for (const id of ids) forgetProjectionMessage(state, id)
  book.floor.delete(sessionID)
  if (state.message_reload) delete state.message_reload[sessionID]
  if (state.message_memory_limited) delete state.message_memory_limited[sessionID]
  if (state.message_truncated) delete state.message_truncated[sessionID]
}
export function getProjectionDelta(state: State, messageID: string, partID: string) {
  return ledger(state).delta.get(messageID)?.get(partID)
}
export function setProjectionDelta(state: State, messageID: string, partID: string, text: string) {
  const book = ledger(state)
  let parts = book.delta.get(messageID)
  if (!parts) book.delta.set(messageID, (parts = new Map()))
  parts.set(partID, text)
}
export function clearProjectionDelta(state: State, messageID: string, partID: string) {
  const book = ledger(state)
  const parts = book.delta.get(messageID)
  parts?.delete(partID)
  if (!parts?.size) book.delta.delete(messageID)
}
/** Rebuild accounting only after authoritative snapshot/undo reload, not per token. */
export function refreshProjectionSizes(state: State, sessionID: string) {
  for (const message of state.message[sessionID] ?? []) {
    const book = ledger(state)
    book.sizes.delete(message.id)
    const ids = new Set((state.part[message.id] ?? []).map((part) => (part as { id: string }).id))
    for (const id of book.delta.get(message.id)?.keys() ?? []) {
      if (!ids.has(id)) clearProjectionDelta(state, message.id, id)
    }
    rememberProjectionMessage(state, { ...message, sessionID })
    for (const part of state.part[message.id] ?? []) {
      rememberProjectionPart(state, { ...(part as { id: string }), messageID: message.id, sessionID })
    }
  }
}
export function enforceTranscriptBudget(
  state: State,
  sessionID: string,
  options: { maxBytes?: number; maxMessages?: number; preserve?: boolean } = {},
) {
  const book = ledger(state)
  const messages = state.message[sessionID] ?? []
  let total = 0
  for (const message of messages) {
    if (!book.sizes.has(message.id)) {
      rememberProjectionMessage(state, { ...message, sessionID })
      for (const part of state.part[message.id] ?? [])
        rememberProjectionPart(state, { ...(part as { id: string }), messageID: message.id, sessionID })
    }
    total += sizeTotal(book.sizes.get(message.id)!)
  }
  const max = options.maxBytes ?? MAX_TRANSCRIPT_BYTES
  while (!options.preserve && (total > max || messages.length > (options.maxMessages ?? 100)) && messages.length > 1) {
    const removed = messages.shift()!
    total -= sizeTotal(book.sizes.get(removed.id)!)
    forgetProjectionMessage(state, removed.id, sessionID)
  }
  if (state.message_memory_limited) state.message_memory_limited[sessionID] = total > max
  return { bytes: total, limited: total > max }
}
