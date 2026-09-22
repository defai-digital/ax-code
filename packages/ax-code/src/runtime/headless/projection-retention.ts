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
// `admitted` is the session whose message list currently contains the message;
// it lets every size mutation route its byte delta to that session's transcript
// total without scanning the list.
type Size = {
  sessionID?: string
  admitted?: string
  info: number
  parts: Map<string, number>
  /** Last measured text per part: the exact serialized byte size of that
   *  string reference, so a snapshot that only extended the text costs
   *  O(suffix) instead of re-serializing the whole part. */
  textMemo?: Map<string, { text: string; entryBytes: number }>
}
type Ledger = {
  sizes: Map<string, Size>
  pending: Set<string>
  /**
   * Exact sum of sizeTotal(sizes.get(id)) over id in pending, maintained at
   * every mutation site so the per-token bound check is O(1) instead of a
   * walk over every pending message and part. Invariant: every id in
   * pending has a sizes entry, and this equals the recomputed sum.
   */
  pendingBytes: number
  /**
   * Exact sum of sizeTotal(sizes.get(id)) over the ids admitted to
   * state.message[sessionID], the mirror of pendingBytes for the admitted set,
   * so enforceTranscriptBudget does not walk every message and part on each
   * transcript event. An absent key means "never built" and triggers the
   * backfill in enforceTranscriptBudget; admitted and pending are disjoint.
   */
  transcript: Map<string, number>
  /** Number of size entries admitted to each session; lets the budget check
   *  detect a message list replaced or trimmed outside the ledger and rebuild
   *  that session's accounting instead of trusting a stale total. */
  transcriptCount: Map<string, number>
  floor: Map<string, string>
  delta: Map<string, Map<string, string>>
}
const ledgers = new WeakMap<object, Ledger>()
function ledger(state: State) {
  let value = ledgers.get(state.part)
  if (!value) {
    value = {
      sizes: new Map(),
      pending: new Set(),
      pendingBytes: 0,
      transcript: new Map(),
      transcriptCount: new Map(),
      floor: new Map(),
      delta: new Map(),
    }
    ledgers.set(state.part, value)
  }
  return value
}
function bytes(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8")
}
const TEXT_KEY_BYTES = Buffer.byteLength('"text":', "utf8")
/**
 * bytes(part) without serializing the accumulated text on every snapshot.
 * JSON.stringify of a plain object is "{" + entries joined by "," + "}", so
 * its length is the text-free remainder plus the text entry plus one comma
 * when the remainder has any entry; key order does not change the sum. The
 * text entry is memoized per part: an unchanged reference costs nothing and a
 * pure extension is measured as bytes(tail + suffix) - bytes(tail), the same
 * boundary-aware arithmetic the delta path uses (a lone surrogate at the old
 * end pairs with the suffix's first unit, so one unit of tail suffices).
 */
function partBytes(entry: Size, part: { id: string; text?: unknown }) {
  if (typeof part.text !== "string") {
    entry.textMemo?.delete(part.id)
    return bytes(part)
  }
  const rest: Record<string, unknown> = { ...part }
  delete rest.text
  const restBytes = bytes(rest)
  const memo = entry.textMemo?.get(part.id)
  let textBytes: number
  if (memo && memo.text === part.text) textBytes = memo.entryBytes
  else if (memo && part.text.length >= memo.text.length && part.text.startsWith(memo.text)) {
    const tail = memo.text.slice(-1)
    textBytes = memo.entryBytes + bytes(tail + part.text.slice(memo.text.length)) - bytes(tail)
  } else textBytes = bytes(part.text)
  ;(entry.textMemo ??= new Map()).set(part.id, { text: part.text, entryBytes: textBytes })
  return restBytes + TEXT_KEY_BYTES + textBytes + (restBytes > 2 ? 1 : 0)
}
function sizeTotal(size: Size) {
  let total = size.info
  for (const value of size.parts.values()) total += value
  return total
}
function creditTranscript(book: Ledger, sessionID: string | undefined, delta: number) {
  if (!sessionID || delta === 0) return
  book.transcript.set(sessionID, (book.transcript.get(sessionID) ?? 0) + delta)
}
/** Count an entry toward a session's transcript (moving it if it was admitted elsewhere). */
function admit(book: Ledger, entry: Size, sessionID: string) {
  if (entry.admitted === sessionID) return
  unadmit(book, entry)
  entry.admitted = sessionID
  creditTranscript(book, sessionID, sizeTotal(entry))
  book.transcriptCount.set(sessionID, (book.transcriptCount.get(sessionID) ?? 0) + 1)
}
function unadmit(book: Ledger, entry: Size) {
  const sessionID = entry.admitted
  if (!sessionID) return
  creditTranscript(book, sessionID, -sizeTotal(entry))
  book.transcriptCount.set(sessionID, (book.transcriptCount.get(sessionID) ?? 0) - 1)
  entry.admitted = undefined
}
function resetTranscript(book: Ledger, sessionID: string) {
  for (const entry of book.sizes.values()) if (entry.admitted === sessionID) entry.admitted = undefined
  book.transcript.delete(sessionID)
  book.transcriptCount.delete(sessionID)
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
  const book = ledger(state)
  const entry = sizeEntry(state, message.id, message.sessionID)
  // Subtract the pre-overwrite total from wherever it was counted: the
  // message leaves pending entirely, and an already admitted message must not
  // be double-counted on a snapshot overwrite. Parts carried while pending
  // move into the transcript total in the same step.
  const before = sizeTotal(entry)
  if (book.pending.delete(message.id)) book.pendingBytes -= before
  unadmit(book, entry)
  entry.info = bytes(message)
  admit(book, entry, message.sessionID)
}
export function admitsProjectionPart(state: State, part: { messageID: string; sessionID?: string }) {
  const sessionID = owner(state, part.messageID, part.sessionID)
  if (!sessionID) return true
  if (state.message[sessionID]?.some((message) => message.id === part.messageID)) return true
  const floor = ledger(state).floor.get(sessionID)
  return !floor || part.messageID > floor
}
export function rememberProjectionPart(state: State, part: { id: string; messageID: string; sessionID?: string }) {
  const book = ledger(state)
  const sessionID = owner(state, part.messageID, part.sessionID)
  const entry = sizeEntry(state, part.messageID, sessionID)
  const before = entry.parts.get(part.id) ?? 0
  const added = partBytes(entry, part)
  entry.parts.set(part.id, added)
  // Pending and transcript accounting are independent: a message backfilled
  // into a transcript while its parts were still pending is counted in both,
  // exactly as the per-call recompute did.
  if (book.pending.has(part.messageID)) {
    // Already counted; only the replaced part's contribution changes.
    book.pendingBytes += added - before
  } else if (
    !entry.admitted &&
    (!sessionID || !state.message[sessionID]?.some((message) => message.id === part.messageID))
  ) {
    book.pending.add(part.messageID)
    book.pendingBytes += sizeTotal(entry)
  }
  if (entry.admitted) creditTranscript(book, entry.admitted, added - before)
  boundPending(state)
}
export function rememberProjectionDelta(
  state: State,
  messageID: string,
  partID: string,
  suffix: string,
  previousTail: string,
) {
  const book = ledger(state)
  const size = book.sizes.get(messageID)
  if (size?.parts.has(partID)) {
    // Keep the boundary-aware delta: a surrogate pair split across
    // previousTail and suffix escapes differently than suffix alone.
    const delta = bytes(previousTail + suffix) - bytes(previousTail)
    size.parts.set(partID, size.parts.get(partID)! + delta)
    if (book.pending.has(messageID)) book.pendingBytes += delta
    if (size.admitted) creditTranscript(book, size.admitted, delta)
  }
  boundPending(state)
}
function boundPending(state: State) {
  const book = ledger(state)
  // pendingBytes already equals the recomputed total; each eviction below
  // subtracts the evicted size through forgetProjectionMessage.
  while (book.pending.size > MAX_PENDING_MESSAGES || book.pendingBytes > MAX_PENDING_BYTES) {
    const id = book.pending.values().next().value
    if (!id) break
    const size = book.sizes.get(id)!
    if (size.sessionID) (state.message_reload ??= {})[size.sessionID] = true
    // Pass the owning session so the eviction raises that session's floor
    // (like every other eviction path here does). Without it, a message
    // that keeps streaming parts after being evicted for exceeding the
    // pending budget gets re-admitted by the very next part event —
    // undoing this eviction and instead evicting an unrelated, still
    // legitimately-pending message in its place.
    forgetProjectionMessage(state, id, size.sessionID)
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
  // Single choke point for every removal path (budget eviction, overflow
  // shift, explicit removal, session clear, pending eviction).
  const size = book.sizes.get(messageID)
  if (size) {
    if (book.pending.delete(messageID)) book.pendingBytes -= sizeTotal(size)
    unadmit(book, size)
  }
  book.sizes.delete(messageID)
  book.pending.delete(messageID)
  book.delta.delete(messageID)
}
export function forgetProjectionPart(state: State, messageID: string, partID: string) {
  const book = ledger(state)
  const size = book.sizes.get(messageID)
  const previous = size?.parts.get(partID)
  if (size && previous !== undefined) {
    size.parts.delete(partID)
    size.textMemo?.delete(partID)
    // Membership persists (info still counts); only this part's bytes leave.
    if (book.pending.has(messageID)) book.pendingBytes -= previous
    if (size.admitted) creditTranscript(book, size.admitted, -previous)
  }
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
  resetTranscript(book, sessionID)
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
  const book = ledger(state)
  // The reload may have dropped messages: reset this session's admitted
  // accounting before the remember* calls below rebuild it, without deleting
  // the dropped entries (owner() and floor admission still consult them).
  resetTranscript(book, sessionID)
  for (const message of state.message[sessionID] ?? []) {
    // Direct sizes removal bypasses forgetProjectionMessage, so settle the
    // pending total here before the entry is rebuilt below.
    const stale = book.sizes.get(message.id)
    if (stale && book.pending.delete(message.id)) book.pendingBytes -= sizeTotal(stale)
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
  // The message list can be replaced or trimmed outside the ledger (snapshot
  // hydration, session leave/prune). Detect that from the admitted count and
  // membership (Map lookups only) and rebuild this session's accounting from
  // the list, which is exactly what the per-call recompute produced.
  // An absent count means nothing is admitted to this session; treat it as 0
  // so an empty list is consistent instead of forcing a ledger-wide reset on
  // every event of a session that has no messages yet.
  const consistent =
    (book.transcriptCount.get(sessionID) ?? 0) === messages.length &&
    messages.every((message) => book.sizes.get(message.id)?.admitted === sessionID)
  if (!consistent) {
    resetTranscript(book, sessionID)
    for (const message of messages) {
      const entry = book.sizes.get(message.id)
      if (!entry) {
        // Never seen: the recompute materialized these from the part table.
        rememberProjectionMessage(state, { ...message, sessionID })
        for (const part of state.part[message.id] ?? [])
          rememberProjectionPart(state, { ...(part as { id: string }), messageID: message.id, sessionID })
      } else {
        // Seen (possibly still pending): admit its current total as-is; the
        // recompute never touched such an entry's info or pending membership.
        admit(book, entry, sessionID)
      }
    }
  }
  let total = book.transcript.get(sessionID) ?? 0
  const max = options.maxBytes ?? MAX_TRANSCRIPT_BYTES
  while (!options.preserve && (total > max || messages.length > (options.maxMessages ?? 100)) && messages.length > 1) {
    const removed = messages.shift()!
    total -= sizeTotal(book.sizes.get(removed.id)!)
    forgetProjectionMessage(state, removed.id, sessionID)
  }
  if (state.message_memory_limited) state.message_memory_limited[sessionID] = total > max
  return { bytes: total, limited: total > max }
}
