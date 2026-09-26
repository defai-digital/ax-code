import { describe, expect, test } from "vitest"
import { recentSessions, recentSessionTitle, sessionRecapPreview } from "@/cli/tui/component/session-picker-view-model"
import { resolveSessionFirstRoute } from "@/cli/tui/navigation/launch-policy"
import { detectNerdFontTerminal, resolveNerdFontEnabled } from "@/cli/tui/ui/glyphs"

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
    expect(result.endsWith("...")).toBe(true)
  })

  test("keeps short titles unchanged", () => {
    expect(recentSessionTitle({ title: "Fix tests" })).toBe("Fix tests")
  })
})

describe("sessionRecapPreview", () => {
  test("collapses model output to a single trimmed line", () => {
    expect(sessionRecapPreview({ text: "  Fixed the\npicker   preview. " })).toBe("Fixed the picker preview.")
  })

  test("returns undefined without a usable recap", () => {
    expect(sessionRecapPreview(undefined)).toBeUndefined()
    expect(sessionRecapPreview({})).toBeUndefined()
    expect(sessionRecapPreview({ text: "   " })).toBeUndefined()
  })

  test("truncates long recaps on grapheme boundaries", () => {
    const result = sessionRecapPreview({ text: "x".repeat(200) }, 20)
    expect(result).toBeDefined()
    expect(Array.from(result!).length).toBeLessThanOrEqual(20)
    expect(result!.endsWith("\u2026")).toBe(true)
    // Astral-plane characters must survive truncation intact.
    expect(sessionRecapPreview({ text: "\u{1F600}".repeat(50) }, 5)).toBe("\u{1F600}".repeat(4) + "\u2026")
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
