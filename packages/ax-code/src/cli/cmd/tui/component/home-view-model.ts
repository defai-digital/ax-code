// Renderer-free view-model helpers for the home route (ADR-031 R4).
// Covered by the TUI layering guard — keep free of solid/opentui imports.

export interface RecentSessionLike {
  id: string
  title?: string
  parentID?: string
  time: { updated: number }
}

// Most recently updated root sessions for the home screen resume list.
export function recentSessions<T extends RecentSessionLike>(sessions: readonly T[], limit = 3): T[] {
  return sessions
    .filter((session) => session.parentID === undefined)
    .toSorted((a, b) => b.time.updated - a.time.updated)
    .slice(0, Math.max(0, limit))
}

export function recentSessionTitle(session: { title?: string }, maxLength = 64): string {
  const title = session.title?.trim()
  if (!title || title.length === 0) return "Untitled session"
  if (title.length <= maxLength) return title
  return `${title.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`
}
