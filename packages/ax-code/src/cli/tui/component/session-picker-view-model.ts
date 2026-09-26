// Renderer-free view-model helpers for session picker and session-first launch (ADR-035).
// Covered by the TUI layering guard — keep free of Solid and renderer imports.

import { Locale } from "@/util/locale"

export interface RecentSessionLike {
  id: string
  title?: string
  parentID?: string
  time: { updated: number }
}

// Most recently updated root sessions for the session picker / resume list.
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
  return `${title.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`
}

/** One-line recap preview for the session picker (ADR-148). The recap is model
 *  output, so collapse it to a single trimmed line and cut it with the picker's
 *  grapheme-aware truncation (arbitrary Unicode would otherwise split). */
export function sessionRecapPreview(recap: { text?: string } | undefined, maxLength = 72): string | undefined {
  const text = recap?.text?.replace(/\s+/gu, " ").trim()
  if (!text) return undefined
  return Locale.truncate(text, maxLength)
}
