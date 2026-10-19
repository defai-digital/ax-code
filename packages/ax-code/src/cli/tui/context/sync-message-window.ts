export const MAX_SESSION_MESSAGES = 100
export const MAX_LOADED_SESSION_MESSAGES = 300

export function sessionMessageLimit(store: { message_window?: Record<string, number> }, sessionID: string) {
  return Math.max(
    MAX_SESSION_MESSAGES,
    Math.min(store.message_window?.[sessionID] ?? MAX_SESSION_MESSAGES, MAX_LOADED_SESSION_MESSAGES),
  )
}

export function adoptHistoryCursor(
  store: {
    message: Record<string, unknown[]>
    message_cursor: Record<string, string>
    message_window: Record<string, number>
  },
  sessionID: string,
  cursor: string | undefined,
) {
  if (cursor) store.message_cursor[sessionID] = cursor
  else delete store.message_cursor[sessionID]
  store.message_window[sessionID] = Math.min(store.message[sessionID]?.length ?? 0, MAX_LOADED_SESSION_MESSAGES)
}

export function oldestMessageIDs(
  store: { message: Record<string, Array<{ id: string }>> },
  sessionIDs: Array<string | undefined>,
) {
  const result = new Map<string, string>()
  for (const sessionID of sessionIDs) {
    const oldest = sessionID ? store.message[sessionID]?.[0]?.id : undefined
    if (sessionID && oldest) result.set(sessionID, oldest)
  }
  return result
}

/**
 * The stored cursor points just before the oldest message that was loaded. Once
 * a live update evicts that message, paging from the cursor would skip whatever
 * was evicted, so drop it; loading earlier then refetches the window instead.
 */
export function invalidateCursorOnEviction(
  store: {
    message: Record<string, Array<{ id: string }>>
    message_cursor?: Record<string, string>
    message_truncated?: Record<string, boolean>
  },
  sessionID: string,
  oldestBefore: string,
) {
  const messages = store.message[sessionID]
  if (!messages?.length || messages.some((message) => message.id === oldestBefore)) return
  if (store.message_cursor) delete store.message_cursor[sessionID]
  if (store.message_truncated) store.message_truncated[sessionID] = true
}
