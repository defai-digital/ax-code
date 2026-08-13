export const WORK_SESSION_SEND_DISABLED =
  "This AX Work session is read-only in AX Code. Export the transcript and continue in AX Work."

export function isLegacyWorkSession(session: { metadata?: Record<string, unknown> | null } | undefined) {
  return session?.metadata != null && session.metadata.work != null
}

export function findSessionById(
  sessionId: string | null | undefined,
  sessions: Array<{ id: string; metadata?: Record<string, unknown> | null }>,
) {
  if (!sessionId) return undefined
  return sessions.find((session) => session.id === sessionId)
}
