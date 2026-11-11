import { scheduleTuiTimeout } from "../util/timer"

// Another process (AX Code Desktop, a second CLI) can run a turn on a session this TUI has open.
// Its runtime writes the turn to the shared store, but publishes it only on its own event stream,
// so the TUI keeps rendering the old transcript until the session is reopened (issue #52).
//
// While a session is open, poll its newest message and resync when it differs from what the TUI
// holds. Turns this TUI's own runtime runs arrive through its event stream, so the poll is skipped
// while that runtime is working on the session.

export const EXTERNAL_SESSION_POLL_INTERVAL_MS = 3000

export interface LatestMessageInfo {
  id: string
  // User messages carry only `created`; assistant messages add `completed` when the turn ends.
  time?: { created?: number; completed?: number } | undefined
}

export interface LatestMessagePart {
  id: string
  state?: { status?: string } | undefined
  // Other part kinds carry different timestamps (for example, retry parts use `created`).
  time?: { end?: number; [key: string]: unknown } | undefined
}

/**
 * Identifies the newest message closely enough to notice another writer: a new message, a new or
 * finished part, or the turn completing. Text deltas inside a part are left out; the part's own
 * completion or the next part still triggers the resync.
 */
export function latestMessageFingerprint(
  info: LatestMessageInfo | undefined,
  parts: readonly LatestMessagePart[] | undefined,
): string {
  if (!info) return "none"
  const last = parts?.at(-1)
  return [
    info.id,
    info.time?.completed ?? "-",
    parts?.length ?? 0,
    last?.id ?? "-",
    last?.state?.status ?? "-",
    last?.time?.end ?? "-",
  ].join(":")
}

export interface ExternalSessionWatchInput {
  /** The newest message and its parts as the shared store has them now. */
  fetchLatest: (sessionID: string) => Promise<{ info: LatestMessageInfo; parts: LatestMessagePart[] } | undefined>
  /** The same fingerprint for what this TUI currently renders. */
  localFingerprint: (sessionID: string) => string
  /** True while this TUI's runtime is running a turn on the session, or its event stream is down. */
  isLocallyCovered: (sessionID: string) => boolean
  resync: (sessionID: string) => Promise<void>
  /** Reported once per run of failures, so an unreachable backend does not log every interval. */
  onError?: (sessionID: string, error: unknown) => void
  intervalMs?: number
  setTimer?: (run: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export interface ExternalSessionWatch {
  watch: (sessionID: string) => () => void
}

export function createExternalSessionWatch(input: ExternalSessionWatchInput): ExternalSessionWatch {
  const intervalMs = input.intervalMs ?? EXTERNAL_SESSION_POLL_INTERVAL_MS
  const setTimer =
    input.setTimer ??
    ((run: () => void, ms: number) => scheduleTuiTimeout(run, { name: "sync.external-session-poll", delayMs: ms }))
  const clearTimer =
    input.clearTimer ??
    ((handle: unknown) => {
      if (typeof handle === "function") handle()
      else clearTimeout(handle as ReturnType<typeof setTimeout>)
    })

  /** Starts watching one session. Returns the function that stops it. */
  function watch(sessionID: string): () => void {
    let stopped = false
    let timer: unknown
    // The last newest-message state seen in the store. A resync happens once per change there, so a
    // fingerprint that never matches the local view (a part the TUI does not keep) cannot loop.
    let lastSeen: string | undefined
    let failing = false

    async function tick(): Promise<void> {
      if (stopped) return
      if (input.isLocallyCovered(sessionID)) {
        // Local events are authoritative now; compare afresh once the runtime goes idle.
        lastSeen = undefined
        return
      }
      const latest = await input.fetchLatest(sessionID)
      if (stopped) return
      // A local turn or disconnection may have taken over while the lookup was pending.
      if (input.isLocallyCovered(sessionID)) {
        lastSeen = undefined
        return
      }
      const remote = latestMessageFingerprint(latest?.info, latest?.parts)
      if (remote === lastSeen) return
      lastSeen = remote
      if (remote === input.localFingerprint(sessionID)) return
      await input.resync(sessionID)
    }

    function schedule(): void {
      if (stopped) return
      timer = setTimer(
        () =>
          tick()
            .then(() => {
              failing = false
            })
            .catch((error) => {
              if (stopped) return
              // A failed resync must be retried on the next change, not skipped as already seen.
              lastSeen = undefined
              if (failing) return
              failing = true
              input.onError?.(sessionID, error)
            })
            .finally(schedule),
        intervalMs,
      )
    }

    schedule()
    return () => {
      stopped = true
      if (timer !== undefined) clearTimer(timer)
    }
  }

  return { watch }
}
