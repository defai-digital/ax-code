import { MAX_LOADED_SESSION_MESSAGES, MAX_SESSION_MESSAGES } from "./sync-message-window"
import type { SyncedMessageParts } from "./sync-session-store"

export type LoadEarlierResult = "loaded" | "exhausted" | "limit" | "busy" | "stale"

export function createEarlierMessageLoader<TMessage, TPart>(input: {
  store: {
    message: Record<string, TMessage[]>
    message_cursor: Record<string, string>
  }
  createFetchPage: () => (
    sessionID: string,
    before: string,
    limit: number,
    signal: AbortSignal,
  ) => Promise<{ data: Array<SyncedMessageParts<TMessage, TPart>> | undefined; response: Response }>
  applyPage: (
    sessionID: string,
    page: Array<SyncedMessageParts<TMessage, TPart>>,
    nextCursor: string | undefined,
  ) => void
  timeoutMs?: number
}) {
  const flights = new Map<string, AbortController>()

  function clear(sessionID: string) {
    const controller = flights.get(sessionID)
    flights.delete(sessionID)
    controller?.abort()
  }

  return {
    clear,
    reset() {
      for (const sessionID of flights.keys()) clear(sessionID)
    },
    async loadEarlier(sessionID: string): Promise<LoadEarlierResult> {
      const cursor = input.store.message_cursor[sessionID]
      if (!cursor) return "exhausted"
      const messages = input.store.message[sessionID]
      if (!messages) return "stale"
      if (messages.length >= MAX_LOADED_SESSION_MESSAGES) return "limit"
      if (flights.has(sessionID)) return "busy"

      const fetchPage = input.createFetchPage()
      const controller = new AbortController()
      flights.set(sessionID, controller)
      const timeoutMs = input.timeoutMs ?? 10_000
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort(new Error(`Loading earlier messages timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      let onAbort!: () => void
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(controller.signal.reason)
        controller.signal.addEventListener("abort", onAbort, { once: true })
      })
      try {
        const result = await Promise.race([
          fetchPage(
            sessionID,
            cursor,
            Math.min(MAX_SESSION_MESSAGES, MAX_LOADED_SESSION_MESSAGES - messages.length),
            controller.signal,
          ),
          aborted,
        ])
        if (
          controller.signal.aborted ||
          input.store.message_cursor[sessionID] !== cursor ||
          !input.store.message[sessionID]
        ) {
          return "stale"
        }
        if (!Array.isArray(result.data)) throw new Error("Invalid message history response")
        input.applyPage(sessionID, result.data, result.response.headers.get("X-Next-Cursor") || undefined)
        return "loaded"
      } catch (error) {
        if (controller.signal.aborted && !timedOut) return "stale"
        throw error
      } finally {
        clearTimeout(timer)
        controller.signal.removeEventListener("abort", onAbort)
        if (flights.get(sessionID) === controller) flights.delete(sessionID)
      }
    },
  }
}
