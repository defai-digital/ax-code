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

export interface SessionSyncController<TSnapshot> {
  clear: (sessionID: string) => void
  reset: () => void
  sync: (sessionID: string, input?: SessionSyncOptions) => Promise<void>
}

export function createSessionSyncController<TSnapshot>(input: {
  fetchSnapshot: (sessionID: string) => Promise<TSnapshot | undefined>
  applySnapshot: (sessionID: string, snapshot: TSnapshot) => void
  onMissingSnapshot?: (sessionID: string) => void
}): SessionSyncController<TSnapshot> {
  const fullSyncedSessions = new Set<string>()
  const inFlightSessions = new Set<string>()

  return {
    clear(sessionID) {
      fullSyncedSessions.delete(sessionID)
      inFlightSessions.delete(sessionID)
    },
    reset() {
      fullSyncedSessions.clear()
      inFlightSessions.clear()
    },
    async sync(sessionID, options) {
      if ((!options?.force && fullSyncedSessions.has(sessionID)) || inFlightSessions.has(sessionID)) return

      inFlightSessions.add(sessionID)
      try {
        const snapshot = await input.fetchSnapshot(sessionID)
        if (!snapshot) {
          input.onMissingSnapshot?.(sessionID)
          if (options?.missing === "throw") throw new MissingSessionSnapshotError(sessionID)
          return
        }
        input.applySnapshot(sessionID, snapshot)
        fullSyncedSessions.add(sessionID)
      } finally {
        inFlightSessions.delete(sessionID)
      }
    },
  }
}
