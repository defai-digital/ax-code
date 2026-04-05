import { describe, expect, test } from "bun:test"
import { dropProjectSession, projectRootForDirectory, rememberProjectSession } from "./route-state"

describe("layout route state helpers", () => {
  test("finds project root from open projects and sandboxes", () => {
    expect(
      projectRootForDirectory({
        directory: "/root/sandbox",
        projects: [{ worktree: "/root", sandboxes: ["/root/sandbox"] }],
        order: {},
        meta: [],
      }),
    ).toBe("/root")
  })

  test("falls back to persisted workspace order when project is not open", () => {
    expect(
      projectRootForDirectory({
        directory: "/root/sandbox",
        projects: [],
        order: { "/root": ["/root/sandbox"] },
        meta: [],
      }),
    ).toBe("/root")
  })

  test("falls back to synced project metadata", () => {
    expect(
      projectRootForDirectory({
        directory: "/tmp/worktree",
        projects: [],
        order: {},
        childProject: "project",
        meta: [{ id: "project", worktree: "/root" }],
      }),
    ).toBe("/root")
  })

  test("returns the original directory when no project root is known", () => {
    expect(
      projectRootForDirectory({
        directory: "/tmp/worktree",
        projects: [],
        order: {},
        meta: [],
      }),
    ).toBe("/tmp/worktree")
  })

  test("stores the latest route for a project root", () => {
    expect(rememberProjectSession({}, "/root", "/root/sandbox", "session", 10)).toEqual({
      "/root": { directory: "/root/sandbox", id: "session", at: 10 },
    })
  })

  test("drops a stored route only when it exists", () => {
    expect(dropProjectSession({ "/root": { directory: "/root", id: "session", at: 10 } }, "/root")).toEqual({})
    const state = {}
    expect(dropProjectSession(state, "/missing")).toBe(state)
  })
})
