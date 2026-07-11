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

export function createSessionSyncController<TSnapshot>(input: {
  fetchSnapshot: (sessionID: string) => Promise<TSnapshot | undefined>
  applySnapshot: (sessionID: string, snapshot: TSnapshot) => void
  onMissingSnapshot?: (sessionID: string) => void
}): SessionSyncController {
  const fullSyncedSessions = new Set<string>()
  /** sessionID -> epoch when the current in-flight sync started (if any). */
  const inFlightEpoch = new Map<string, number>()
  /**
   * sessionID -> generation. Bumped by clear/reset so an in-flight fetch that
   * completes after leave-prune cannot applySnapshot or re-mark fullSynced
   * (ADR-047 leave prune + re-enter).
   */
  const epoch = new Map<string, number>()

  function currentEpoch(sessionID: string) {
    return epoch.get(sessionID) ?? 0
  }

  function bumpEpoch(sessionID: string) {
    const next = currentEpoch(sessionID) + 1
    epoch.set(sessionID, next)
    return next
  }

  return {
    clear(sessionID) {
      fullSyncedSessions.delete(sessionID)
      inFlightEpoch.delete(sessionID)
      bumpEpoch(sessionID)
    },
    reset() {
      fullSyncedSessions.clear()
      // Bump every session that has ever synced or is in-flight so late
      // applySnapshot cannot re-mark fullSynced after reset. Keep the epoch
      // map (do not zero it) so in-flight work started at epoch 0 goes stale.
      for (const sessionID of new Set([...epoch.keys(), ...inFlightEpoch.keys()])) {
        bumpEpoch(sessionID)
      }
      inFlightEpoch.clear()
    },
    async sync(sessionID, options) {
      if (!options?.force && fullSyncedSessions.has(sessionID)) return
      if (inFlightEpoch.has(sessionID)) return

      const startedEpoch = currentEpoch(sessionID)
      inFlightEpoch.set(sessionID, startedEpoch)
      try {
        const snapshot = await input.fetchSnapshot(sessionID)
        // Leave/clear ran while we were fetching — drop the result.
        if (startedEpoch !== currentEpoch(sessionID)) return
        if (!snapshot) {
          input.onMissingSnapshot?.(sessionID)
          if (options?.missing === "throw") throw new MissingSessionSnapshotError(sessionID)
          return
        }
        input.applySnapshot(sessionID, snapshot)
        // Leave/clear ran between apply and mark — do not trust fullSynced.
        if (startedEpoch !== currentEpoch(sessionID)) return
        fullSyncedSessions.add(sessionID)
      } finally {
        // Only release in-flight if we still own this flight. A clear()+new
        // sync may have replaced inFlightEpoch with a newer epoch.
        if (inFlightEpoch.get(sessionID) === startedEpoch) {
          inFlightEpoch.delete(sessionID)
        }
      }
    },
  }
}
