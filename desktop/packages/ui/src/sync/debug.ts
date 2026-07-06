/**
 * Sync debug logging — gated behind localStorage flag.
 *
 * Enable in browser console:
 *   localStorage.setItem("openchamber:sync:debug", "1")
 *
 * Disable:
 *   localStorage.removeItem("openchamber:sync:debug")
 *
 * All checks are early-returns on the hot path — zero cost when disabled.
 */

const FLAG_KEY = "openchamber:sync:debug"

let _enabled: boolean | undefined

export function isSyncDebugEnabled(): boolean {
  if (_enabled !== undefined) return _enabled
  try {
    _enabled = typeof localStorage !== "undefined" && localStorage.getItem(FLAG_KEY) === "1"
  } catch {
    _enabled = false
  }
  return _enabled
}

/** Force-refresh the flag (call after user toggles localStorage). */
export function refreshSyncDebugFlag(): void {
  _enabled = undefined
}

type SyncDebugCategory = "pipeline" | "reducer" | "dispatch"

function log(cat: SyncDebugCategory, message: string): void {
  if (!isSyncDebugEnabled()) return
  const tag = `%c[sync:${cat}]`
  const style = "color: #888"
  console.log(tag, style, message)
}

export const syncDebug = {
  pipeline: {
    /** Event coalesced (replaced an earlier event in the queue). */
    coalesced: (_eventType: string, _coalesceKey: string) => log("pipeline", "event coalesced"),

    /** Flush batch dispatched. */
    flush: (_count: number) => log("pipeline", "batch flushed"),
  },

  reducer: {
    /** message.updated skipped because role/finish/completed matched existing. */
    messageUpdatedUnchanged: (
      _sessionID: string,
      _messageID: string,
      _role: string,
      _finish: unknown,
      _completed: unknown,
    ) => log("reducer", "message.updated unchanged"),

    /** message.part.updated arrived but no parts array exists for this messageID. */
    partUpdatedNoExistingParts: (_messageID: string, _partID: string, _partType: string) =>
      log("reducer", "message.part.updated missing existing parts"),

    /** message.part.delta arrived but parts array missing — silently dropped. */
    partDeltaNoParts: (_messageID: string, _partID: string) => log("reducer", "message.part.delta missing parts"),

    /** message.part.delta arrived but partID not found in parts array. */
    partDeltaNotFound: (_messageID: string, _partID: string) => log("reducer", "message.part.delta part not found"),

    /** SKIP_PARTS filtered out a part. */
    partSkipped: (_messageID: string, _partID: string, _partType: string) =>
      log("reducer", "message.part.updated skipped"),
  },

  dispatch: {
    /** Event dispatched to store but reducer returned false (no state change). */
    eventNoChange: (_eventType: string, _sessionID?: string, _messageID?: string) =>
      log("dispatch", "event produced no state change"),

    /** Event applied to store successfully. */
    eventApplied: (_eventType: string, _sessionID?: string, _messageID?: string) => log("dispatch", "event applied"),
  },
} as const
