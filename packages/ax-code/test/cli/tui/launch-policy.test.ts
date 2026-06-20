import { describe, expect, test } from "vitest"
import { resolveSessionFirstRoute, type TuiLaunchInput } from "@/cli/cmd/tui/navigation/launch-policy"

describe("resolveSessionFirstRoute", () => {
  test("explicit session ID wins over recent sessions", () => {
    const input: TuiLaunchInput = {
      explicitSessionID: "session-123",
      recentSessionIDs: ["other-session"],
      hasProjectContext: true,
    }
    const result = resolveSessionFirstRoute(input)
    expect(result).toEqual({ type: "session", sessionID: "session-123" })
  })

  test("explicit prompt opens new session with the prompt", () => {
    const input: TuiLaunchInput = {
      explicitPrompt: "Fix the bug",
      recentSessionIDs: ["recent-session"],
      hasProjectContext: true,
    }
    const result = resolveSessionFirstRoute(input)
    expect(result).toEqual({ type: "new-session", prompt: "Fix the bug" })
  })

  test("explicit session ID wins over explicit prompt", () => {
    const input: TuiLaunchInput = {
      explicitSessionID: "session-456",
      explicitPrompt: "Some prompt",
      recentSessionIDs: [],
      hasProjectContext: true,
    }
    const result = resolveSessionFirstRoute(input)
    expect(result).toEqual({ type: "session", sessionID: "session-456" })
  })

  test("most recent session is selected when no explicit args", () => {
    const input: TuiLaunchInput = {
      recentSessionIDs: ["most-recent", "older", "oldest"],
      hasProjectContext: true,
    }
    const result = resolveSessionFirstRoute(input)
    expect(result).toEqual({ type: "session", sessionID: "most-recent" })
  })

  test("new session fallback when no recent sessions", () => {
    const input: TuiLaunchInput = {
      recentSessionIDs: [],
      hasProjectContext: true,
    }
    const result = resolveSessionFirstRoute(input)
    expect(result).toEqual({ type: "new-session" })
  })

  test("new session fallback when no project context and no sessions", () => {
    const input: TuiLaunchInput = {
      recentSessionIDs: [],
      hasProjectContext: false,
    }
    const result = resolveSessionFirstRoute(input)
    expect(result).toEqual({ type: "new-session" })
  })

  test("never returns home or dashboard type", () => {
    const inputs: TuiLaunchInput[] = [
      { explicitSessionID: "s1", recentSessionIDs: [], hasProjectContext: true },
      { explicitPrompt: "prompt", recentSessionIDs: [], hasProjectContext: true },
      { recentSessionIDs: ["s2"], hasProjectContext: true },
      { recentSessionIDs: [], hasProjectContext: true },
      { recentSessionIDs: [], hasProjectContext: false },
    ]

    for (const input of inputs) {
      const result = resolveSessionFirstRoute(input)
      expect(result.type).not.toBe("home")
      expect(result.type).not.toBe("dashboard")
      expect(["session", "new-session"]).toContain(result.type)
    }
  })

  test("handles undefined explicitSessionID and explicitPrompt", () => {
    const input: TuiLaunchInput = {
      recentSessionIDs: ["fallback-session"],
      hasProjectContext: true,
    }
    const result = resolveSessionFirstRoute(input)
    expect(result).toEqual({ type: "session", sessionID: "fallback-session" })
  })
})
