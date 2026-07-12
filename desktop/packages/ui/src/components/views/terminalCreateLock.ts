/**
 * Coalesce concurrent createSession calls for the same directory tab.
 * Multiple TerminalView hosts (main tab, bottom dock, split pane) can mount at
 * once and race to create a PTY; only the first create should win.
 */
const inflightCreates = new Map<string, Promise<string>>()

export const terminalCreateLockKey = (directory: string, tabId: string): string => `${directory}::${tabId}`

export async function withTerminalSessionCreate(
  directory: string,
  tabId: string,
  create: () => Promise<string>,
): Promise<string> {
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

/** Test helper — clears any in-flight creates between cases. */
export function resetTerminalCreateLocksForTests(): void {
  inflightCreates.clear()
}
