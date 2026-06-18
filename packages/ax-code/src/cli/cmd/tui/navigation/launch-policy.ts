// Renderer-neutral launch policy for session-first TUI (ADR-035).
// Decides the initial route from CLI args and available sessions.
// Keep free of solid/opentui imports.

export type TuiLaunchInput = {
  explicitSessionID?: string
  explicitPrompt?: string
  recentSessionIDs: string[]
  hasProjectContext: boolean
}

export type TuiLaunchDecision = { type: "session"; sessionID: string } | { type: "new-session"; prompt?: string }

/**
 * Resolve the session-first launch route.
 *
 * Priority:
 * 1. Explicit session ID (--session)
 * 2. Explicit prompt (--prompt)
 * 3. Most recent session (auto-resume)
 * 4. New session fallback
 *
 * Never returns a dashboard/home route.
 */
export function resolveSessionFirstRoute(input: TuiLaunchInput): TuiLaunchDecision {
  if (input.explicitSessionID) {
    return { type: "session", sessionID: input.explicitSessionID }
  }
  if (input.explicitPrompt) {
    return { type: "new-session", prompt: input.explicitPrompt }
  }
  if (input.recentSessionIDs.length > 0) {
    const sessionID = input.recentSessionIDs[0]
    if (sessionID) return { type: "session", sessionID }
  }
  return { type: "new-session" }
}
