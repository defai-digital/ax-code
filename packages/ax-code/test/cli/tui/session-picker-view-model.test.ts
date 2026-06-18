import { describe, expect, test } from "bun:test"
import { recentSessions, recentSessionTitle } from "@/cli/cmd/tui/component/session-picker-view-model"
import { resolveSessionFirstRoute } from "@/cli/cmd/tui/navigation/launch-policy"
import { detectNerdFontTerminal, resolveNerdFontEnabled } from "@/cli/cmd/tui/ui/glyphs"

function session(id: string, updated: number, extra: { title?: string; parentID?: string } = {}) {
  return { id, time: { updated }, ...extra }
}

describe("recentSessions", () => {
  test("returns the most recently updated sessions first", () => {
    const result = recentSessions([session("a", 1), session("b", 3), session("c", 2)])
    expect(result.map((s) => s.id)).toEqual(["b", "c", "a"])
  })

  test("limits the result and excludes child sessions", () => {
    const result = recentSessions([
      session("a", 4),
      session("child", 9, { parentID: "a" }),
      session("b", 3),
      session("c", 2),
      session("d", 1),
    ])
    expect(result.map((s) => s.id)).toEqual(["a", "b", "c"])
  })

  test("does not mutate the input order", () => {
    const input = [session("a", 1), session("b", 2)]
    recentSessions(input)
    expect(input.map((s) => s.id)).toEqual(["a", "b"])
  })
})

describe("recentSessionTitle", () => {
  test("falls back for missing or blank titles", () => {
    expect(recentSessionTitle({})).toBe("Untitled session")
    expect(recentSessionTitle({ title: "   " })).toBe("Untitled session")
  })

  test("truncates long titles with an ellipsis", () => {
    const title = "x".repeat(100)
    const result = recentSessionTitle({ title }, 10)
    expect(result.length).toBeLessThanOrEqual(10)
    expect(result.endsWith("…")).toBe(true)
  })

  test("keeps short titles unchanged", () => {
    expect(recentSessionTitle({ title: "Fix tests" })).toBe("Fix tests")
  })
})

describe("session-first launch integration", () => {
  test("recentSessions output feeds resolveSessionFirstRoute", () => {
    const sessions = [
      session("old", 1, { title: "Old session" }),
      session("new", 5, { title: "New session" }),
      session("mid", 3, { title: "Mid session" }),
    ]
    const recent = recentSessions(sessions)
    const ids = recent.map((s) => s.id)

    const decision = resolveSessionFirstRoute({
      recentSessionIDs: ids,
      hasProjectContext: true,
    })

    expect(decision).toEqual({ type: "session", sessionID: "new" })
  })

  test("empty recentSessions yields new-session decision", () => {
    const sessions = [session("child", 5, { parentID: "parent" })]
    const recent = recentSessions(sessions)

    const decision = resolveSessionFirstRoute({
      recentSessionIDs: recent.map((s) => s.id),
      hasProjectContext: true,
    })

    expect(decision).toEqual({ type: "new-session" })
  })
})

describe("nerd font detection", () => {
  test("detects bundled-symbols terminals only", () => {
    expect(detectNerdFontTerminal({ term: "xterm-kitty" })).toBe(true)
    expect(detectNerdFontTerminal({ termProgram: "WezTerm" })).toBe(true)
    expect(detectNerdFontTerminal({ termProgram: "ghostty" })).toBe(true)
    expect(detectNerdFontTerminal({ termProgram: "iTerm.app" })).toBe(false)
    expect(detectNerdFontTerminal({ termProgram: "Apple_Terminal" })).toBe(false)
    expect(detectNerdFontTerminal({})).toBe(false)
  })

  test("resolution precedence: env over kv over detection", () => {
    expect(resolveNerdFontEnabled({ env: false, kv: true, detected: true })).toBe(false)
    expect(resolveNerdFontEnabled({ env: true, kv: false, detected: false })).toBe(true)
    expect(resolveNerdFontEnabled({ kv: false, detected: true })).toBe(false)
    expect(resolveNerdFontEnabled({ kv: true, detected: false })).toBe(true)
    expect(resolveNerdFontEnabled({ detected: true })).toBe(true)
    expect(resolveNerdFontEnabled({})).toBe(false)
  })
})
