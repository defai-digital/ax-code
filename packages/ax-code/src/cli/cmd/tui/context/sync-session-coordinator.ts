export class MissingSessionSnapshotError extends Error {
  readonly sessionID: string

  constructor(sessionID: string) {
    super(`Session snapshot unavailable: ${sessionID}`)
    this.name = "MissingSessionSnapshotError"
    this.sessionID = sessionID
  }
}

export function isMissingSessionSnapshotError(error: unknown): error is MissingSessionSnapshotError {
  return error instanceof MissingSessionSnapshotError
}

export interface SessionSyncOptions {
  force?: boolean
  missing?: "ignore" | "throw"
}

export interface SessionSyncController {
  clear: (sessionID: string) => void
  reset: () => void
  sync: (sessionID: string, input?: SessionSyncOptions) => Promise<void>
}

type InFlightEntry = {
  promise: Promise<void>
  /** Epoch observed when this flight began; clear/reset bumps epoch. */
  startedEpoch: number
}

export type SessionSyncSnapshotApplyMode = "full" | "enrichment"

export function createSessionSyncController<TSnapshot>(input: {
  fetchSnapshot: (
    sessionID: string,
    options?: {
      /**
       * Progressive core snapshot (session/messages/todo) applied as soon as
       * it is ready so the transcript can paint before enrichment (diff/risk/goal).
       * Callers must respect epoch/generation themselves when wiring this.
       */
      onCoreReady?: (snapshot: TSnapshot) => void
    },
  ) => Promise<TSnapshot | undefined>
  applySnapshot: (sessionID: string, snapshot: TSnapshot, mode?: SessionSyncSnapshotApplyMode) => void
  onMissingSnapshot?: (sessionID: string) => void
}): SessionSyncController {
  const fullSyncedSessions = new Set<string>()
  /**
   * sessionID -> generation. Bumped by clear/reset so an in-flight fetch that
   * completes after leave-prune cannot applySnapshot or re-mark fullSynced
   * (ADR-047 leave prune + re-enter).
   */
  const epoch = new Map<string, number>()
  /** In-flight sync promises so concurrent callers await the same flight. */
  const inFlight = new Map<string, InFlightEntry>()

  function currentEpoch(sessionID: string) {
    return epoch.get(sessionID) ?? 0
  }

  function bumpEpoch(sessionID: string) {
    const next = currentEpoch(sessionID) + 1
    epoch.set(sessionID, next)
    return next
  }

  function isCurrent(sessionID: string, startedEpoch: number) {
    return startedEpoch === currentEpoch(sessionID)
  }

  async function runSync(sessionID: string, options: SessionSyncOptions | undefined, startedEpoch: number) {
    let coreApplied = false
    const applyIfCurrent = (snapshot: TSnapshot, mode: SessionSyncSnapshotApplyMode = "full") => {
      if (!isCurrent(sessionID, startedEpoch)) return false
      input.applySnapshot(sessionID, snapshot, mode)
      return true
    }

    const snapshot = await input.fetchSnapshot(sessionID, {
      onCoreReady: (core) => {
        if (applyIfCurrent(core, "full")) coreApplied = true
      },
    })
    // Leave/clear ran while we were fetching — drop the result.
    if (!isCurrent(sessionID, startedEpoch)) return
    if (!snapshot) {
      input.onMissingSnapshot?.(sessionID)
      if (options?.missing === "throw") throw new MissingSessionSnapshotError(sessionID)
      return
    }
    // After progressive core paint, only patch enrichment so live stream part
    // deltas that arrived mid-fetch are not overwritten by the older snapshot.
    applyIfCurrent(snapshot, coreApplied ? "enrichment" : "full")
    // Leave/clear ran between apply and mark — do not trust fullSynced.
    if (!isCurrent(sessionID, startedEpoch)) return
    fullSyncedSessions.add(sessionID)
  }

  return {
    clear(sessionID) {
      fullSyncedSessions.delete(sessionID)
      bumpEpoch(sessionID)
    },
    reset() {
      fullSyncedSessions.clear()
      // Bump every session that has ever synced or is in-flight so late
      // applySnapshot cannot re-mark fullSynced after reset. Keep the epoch
      // map (do not zero it) so in-flight work started at epoch 0 goes stale.
      for (const sessionID of new Set([...epoch.keys(), ...inFlight.keys()])) {
        bumpEpoch(sessionID)
      }
    },
    async sync(sessionID, options) {
      // Join any in-flight work first so `await sync()` always means that
      // flight has finished applying (or been invalidated). Without this,
      // concurrent callers returned immediately while the first fetch was
      // still running — session entry could treat sync as done with empty data.
      while (true) {
        if (!options?.force && fullSyncedSessions.has(sessionID)) return

        const existing = inFlight.get(sessionID)
        if (existing) {
          await existing.promise
          // Shared success for the current epoch.
          if (!options?.force && fullSyncedSessions.has(sessionID)) return
          // clear/reset invalidated the flight we joined — start a fresh one
          // (leave prune + re-enter). Force refresh also continues.
          if (options?.force || existing.startedEpoch !== currentEpoch(sessionID)) {
            continue
          }
          // Flight finished for this epoch without fullSynced (missing/error
          // already observed by the shared promise). Share that outcome.
          return
        }

        const startedEpoch = currentEpoch(sessionID)
        const flight = runSync(sessionID, options, startedEpoch).finally(() => {
          const current = inFlight.get(sessionID)
          if (current?.promise === flight) {
            inFlight.delete(sessionID)
          }
        })
        inFlight.set(sessionID, { promise: flight, startedEpoch })
        await flight
        return
      }
    },
  }
}
