import { describe, expect, test } from "vitest"
import type { Session } from "@ax-code/sdk/v2"

import { isPathWithinProject, isSessionRelatedToProject, resolveArchivedFolderName } from "./utils"

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
