import { describe, expect, test } from "bun:test"
import { projectByOffset, sessionIndexByOffset, unseenSessionIndex } from "./navigation"

describe("layout navigation helpers", () => {
  test("wraps session offset navigation from the active session", () => {
    const sessions = [{ id: "a" }, { id: "b" }, { id: "c" }]

    expect(sessionIndexByOffset(sessions, "b", 1)).toBe(2)
    expect(sessionIndexByOffset(sessions, "a", -1)).toBe(2)
  })

  test("falls back to first or last session when none is active", () => {
    const sessions = [{ id: "a" }, { id: "b" }, { id: "c" }]

    expect(sessionIndexByOffset(sessions, undefined, 1)).toBe(0)
    expect(sessionIndexByOffset(sessions, undefined, -1)).toBe(2)
  })

  test("wraps project offset navigation", () => {
    const projects = [{ worktree: "/a" }, { worktree: "/b" }, { worktree: "/c" }]

    expect(projectByOffset(projects, "/c", 1)?.worktree).toBe("/a")
    expect(projectByOffset(projects, "/a", -1)?.worktree).toBe("/c")
  })

  test("falls back to first or last project when none is active", () => {
    const projects = [{ worktree: "/a" }, { worktree: "/b" }, { worktree: "/c" }]

    expect(projectByOffset(projects, undefined, 1)?.worktree).toBe("/a")
    expect(projectByOffset(projects, undefined, -1)?.worktree).toBe("/c")
  })

  test("finds the next unseen session after the active one", () => {
    const sessions = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]
    const unseen = new Set(["d"])

    expect(unseenSessionIndex(sessions, "b", 1, (session) => (unseen.has(session.id) ? 1 : 0))).toBe(3)
  })

  test("wraps backward when finding previous unseen session", () => {
    const sessions = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]
    const unseen = new Set(["a"])

    expect(unseenSessionIndex(sessions, "c", -1, (session) => (unseen.has(session.id) ? 1 : 0))).toBe(0)
  })

  test("returns nothing when no session is unseen", () => {
    const sessions = [{ id: "a" }, { id: "b" }]

    expect(unseenSessionIndex(sessions, "a", 1, () => 0)).toBeUndefined()
  })
})
