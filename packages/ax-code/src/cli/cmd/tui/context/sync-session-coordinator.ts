export interface SessionSyncController<TSnapshot> {
  clear: (sessionID: string) => void
  reset: () => void
  sync: (sessionID: string, input?: { force?: boolean }) => Promise<void>
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
