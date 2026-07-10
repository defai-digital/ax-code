import { describe, expect, test } from "vitest"
import type { Session } from "@ax-code/sdk/v2"

import {
  isPathWithinProject,
  isSessionOwnedByProject,
  isSessionRelatedToProject,
  resolveArchivedFolderName,
  resolveOwningProjectRoot,
} from "./utils"

type SidebarSession = Partial<Session> & {
  directory?: string | null
  project?: { worktree?: string | null } | null
}

const session = (value: SidebarSession): Session => value as Session

describe("isPathWithinProject", () => {
  test("matches child directories for root projects", () => {
    expect(isPathWithinProject("/workspace/app", "/")).toBe(true)
  })

  test("matches exact project directories", () => {
    expect(isPathWithinProject("/workspace/app", "/workspace/app")).toBe(true)
  })

  test("does not match sibling directory prefixes", () => {
    expect(isPathWithinProject("/workspace/app2", "/workspace/app")).toBe(false)
  })

  test("returns false when directory is null", () => {
    expect(isPathWithinProject(null, "/workspace/app")).toBe(false)
  })

  test("returns false when projectPath is null", () => {
    expect(isPathWithinProject("/workspace/app", null)).toBe(false)
  })

  test("matches deep child directories", () => {
    expect(isPathWithinProject("/workspace/app/sub/dir", "/workspace/app")).toBe(true)
  })

  test("matches Windows project paths case-insensitively", () => {
    expect(isPathWithinProject("c:/Users/Alice/Project/src", "C:/Users/Alice/Project")).toBe(true)
  })

  test("keeps POSIX project paths case-sensitive", () => {
    expect(isPathWithinProject("/users/Alice/Project/src", "/Users/Alice/Project")).toBe(false)
  })
})

describe("resolveArchivedFolderName", () => {
  test("uses Windows case-insensitive project roots for folder names", () => {
    expect(
      resolveArchivedFolderName(
        session({
          id: "session-1",
          directory: "c:/users/alice/project/.worktrees/Feature",
        }),
        "C:/Users/Alice/Project",
      ),
    ).toBe("Feature")
  })
})

describe("isSessionRelatedToProject", () => {
  test("matches Windows project worktrees case-insensitively", () => {
    expect(
      isSessionRelatedToProject(
        session({
          id: "session-1",
          project: { worktree: "c:/users/alice/project/.worktrees/Feature" },
        }),
        "C:/Users/Alice/Project",
      ),
    ).toBe(true)
  })

  test("does not match Windows sibling project worktrees", () => {
    expect(
      isSessionRelatedToProject(
        session({
          id: "session-1",
          project: { worktree: "C:/Users/Alice/ProjectCopy/.worktrees/Feature" },
        }),
        "C:/Users/Alice/Project",
      ),
    ).toBe(false)
  })
})

describe("resolveOwningProjectRoot / isSessionOwnedByProject", () => {
  const home = "/Users/alvinhu"
  const app = "/Users/alvinhu/autoapplication"
  const roots = [home, app]

  test("assigns a nested session to its most-specific project, not an ancestor", () => {
    const s = session({ id: "s1", directory: "/Users/alvinhu/autoapplication/src" })
    expect(resolveOwningProjectRoot(s, roots)).toBe(app)
    expect(isSessionOwnedByProject(s, app, roots)).toBe(true)
    // The home (~) project must NOT also claim it — this is the duplicate-rendering bug.
    expect(isSessionOwnedByProject(s, home, roots)).toBe(false)
  })

  test("keeps a session living directly under the ancestor with the ancestor", () => {
    const s = session({ id: "s2", directory: "/Users/alvinhu/notes" })
    expect(resolveOwningProjectRoot(s, roots)).toBe(home)
    expect(isSessionOwnedByProject(s, home, roots)).toBe(true)
    expect(isSessionOwnedByProject(s, app, roots)).toBe(false)
  })

  test("falls back to project.worktree when the session has no directory", () => {
    const s = session({ id: "s3", project: { worktree: "/Users/alvinhu/autoapplication/.worktrees/feat" } })
    expect(resolveOwningProjectRoot(s, roots)).toBe(app)
  })

  test("prefers a project reached via its worktree over an ancestor root match", () => {
    const worktrees = new Map([[app, [{ path: "/Users/alvinhu/wt/feature" }]]])
    const s = session({ id: "s4", directory: "/Users/alvinhu/wt/feature/src" })
    expect(resolveOwningProjectRoot(s, roots, worktrees)).toBe(app)
    expect(isSessionOwnedByProject(s, app, roots, worktrees)).toBe(true)
    expect(isSessionOwnedByProject(s, home, roots, worktrees)).toBe(false)
  })

  test("returns null when no registered root matches", () => {
    const s = session({ id: "s5", directory: "/tmp/elsewhere" })
    expect(resolveOwningProjectRoot(s, roots)).toBeNull()
  })
})
