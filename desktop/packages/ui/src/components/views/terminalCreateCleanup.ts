export type CloseTerminalSession = (sessionId: string) => Promise<void>
export type SetTerminalConnecting = (directory: string, tabId: string, isConnecting: boolean) => void

export const cleanupStaleCreatedTerminalSession = async (
  closeSession: CloseTerminalSession,
  setConnecting: SetTerminalConnecting,
  directory: string,
  tabId: string,
  sessionId: string,
): Promise<void> => {
  setConnecting(directory, tabId, false)
  try {
    await closeSession(sessionId)
  } catch {
    // Best effort cleanup: the stale tab must still stop showing "connecting".
  }
}
