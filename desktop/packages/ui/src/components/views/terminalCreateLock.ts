/**
 * Coalesce concurrent createSession calls for the same directory tab.
 * Multiple TerminalView hosts (main tab, bottom dock, split pane) can mount at
 * once and race to create a PTY; only the first create should win.
 */
const inflightCreates = new Map<string, Promise<string | null>>()

export const terminalCreateLockKey = (directory: string, tabId: string): string => `${directory}::${tabId}`

export async function withTerminalSessionCreate(
  directory: string,
  tabId: string,
  create: () => Promise<string | null>,
): Promise<string | null> {
  const key = terminalCreateLockKey(directory, tabId)
  const existing = inflightCreates.get(key)
  if (existing) {
    return existing
  }

  const promise = (async () => {
    try {
      return await create()
    } finally {
      inflightCreates.delete(key)
    }
  })()

  inflightCreates.set(key, promise)
  return promise
}

export type ClaimedTerminalSessionDependencies = {
  getClaimedSessionId: () => string | null
  createSession: () => Promise<string>
  claimSession: (sessionId: string) => boolean
  closeSession: (sessionId: string) => Promise<void>
}

const closeOrphanedSession = async (
  closeSession: ClaimedTerminalSessionDependencies["closeSession"],
  sessionId: string,
): Promise<void> => {
  try {
    await closeSession(sessionId)
  } catch {
    // Best effort: failure to clean up an orphan must not replace a usable
    // session that another renderer already claimed.
  }
}

/**
 * Create at most one PTY for a tab and claim it in the shared store before any
 * coalesced caller resumes. Claim-before-resume is important: a React effect
 * can be cancelled while another mounted TerminalView is awaiting the same
 * create. The cancelled caller must never mistake that shared PTY for an
 * orphan and close it before the live caller can attach.
 */
export async function ensureClaimedTerminalSession(
  directory: string,
  tabId: string,
  dependencies: ClaimedTerminalSessionDependencies,
): Promise<string | null> {
  return withTerminalSessionCreate(directory, tabId, async () => {
    const existingSessionId = dependencies.getClaimedSessionId()
    if (existingSessionId) {
      return existingSessionId
    }

    const createdSessionId = await dependencies.createSession()

    // A restart or another owner may have claimed a session while creation was
    // in flight. Keep the winner and dispose only the unclaimed duplicate.
    const racedSessionId = dependencies.getClaimedSessionId()
    if (racedSessionId) {
      if (racedSessionId !== createdSessionId) {
        await closeOrphanedSession(dependencies.closeSession, createdSessionId)
      }
      return racedSessionId
    }

    if (dependencies.claimSession(createdSessionId)) {
      return createdSessionId
    }

    // The tab was removed while its PTY was starting, so no renderer can own
    // the result. Clean it up inside the coordinator and report no session.
    await closeOrphanedSession(dependencies.closeSession, createdSessionId)
    return null
  })
}

/** Test helper — clears any in-flight creates between cases. */
export function resetTerminalCreateLocksForTests(): void {
  inflightCreates.clear()
}
