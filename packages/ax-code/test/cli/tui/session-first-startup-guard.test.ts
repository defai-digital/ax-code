// Session-first startup guard test (ADR-035).
//
// Validates the pure-logic contract that the app.tsx createEffect relies on:
// when AX_CODE_TUI_SESSION_FIRST is enabled and no explicit CLI args are given,
// the launch policy must produce a non-home decision whenever recent sessions
// are available, ensuring the TUI does not remain on the home route.

import { describe, expect, test } from "bun:test"
import { resolveSessionFirstRoute, type TuiLaunchDecision } from "@/cli/cmd/tui/navigation/launch-policy"

/**
 * Simulate the flag-gated decision path in app.tsx:
 * - Flag.AX_CODE_TUI_SESSION_FIRST is true
 * - No args.sessionID, args.continue, or args.prompt
 * - route.data.type === "home"
 * - sync.data.session_loaded is true
 */
function simulateSessionFirstEffect(recentSessionIDs: string[]): { navigated: boolean; decision: TuiLaunchDecision } {
  const decision = resolveSessionFirstRoute({
    recentSessionIDs,
    hasProjectContext: true,
  })
  return {
    navigated: decision.type === "session",
    decision,
  }
}

describe("session-first startup guard (ADR-035)", () => {
  test("does not remain on home route when recent sessions exist", () => {
    const result = simulateSessionFirstEffect(["ses_recent"])
    expect(result.navigated).toBe(true)
    expect(result.decision).toEqual({ type: "session", sessionID: "ses_recent" })
  })

  test("auto-resumes the most recent session", () => {
    const result = simulateSessionFirstEffect(["ses_newest", "ses_older", "ses_oldest"])
    expect(result.navigated).toBe(true)
    expect(result.decision).toEqual({ type: "session", sessionID: "ses_newest" })
  })

  test("stays on new-session (not home) when no recent sessions", () => {
    const result = simulateSessionFirstEffect([])
    expect(result.navigated).toBe(false)
    expect(result.decision.type).toBe("new-session")
    // The key invariant: the decision is never "home" or "dashboard"
    expect(result.decision.type).not.toBe("home")
    expect(result.decision.type).not.toBe("dashboard")
  })

  test("never produces a home/dashboard decision across all valid inputs", () => {
    const scenarios = [{ recentSessionIDs: ["a", "b"] }, { recentSessionIDs: ["single"] }, { recentSessionIDs: [] }]
    for (const s of scenarios) {
      const result = simulateSessionFirstEffect(s.recentSessionIDs)
      expect(result.decision.type).not.toBe("home")
      expect(result.decision.type).not.toBe("dashboard")
    }
  })
})
