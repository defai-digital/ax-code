import { describe, expect, test } from "vitest"
import type { ProjectEntry } from "@/lib/api/types"
import type { WorktreeMetadata } from "@/types/worktree"

import { resolveProjectForDirectory, resolveProjectForSessionDirectory } from "./projectResolution"

const project = (id: string, path: string): ProjectEntry => ({
  id,
  path,
  label: id,
})

const worktree = (path: string, projectDirectory: string): WorktreeMetadata => ({
  path,
  projectDirectory,
  branch: "main",
  label: "main",
})

describe("resolveProjectForDirectory", () => {
  test("matches Windows drive paths case-insensitively", () => {
    const projects = [project("app", "C:/Users/Alice/Project")]

    expect(resolveProjectForDirectory(projects, "c:/Users/Alice/Project/src")?.id).toBe("app")
  })

  test("matches child paths under a Windows drive root project", () => {
    const projects = [project("drive", "C:/")]

    expect(resolveProjectForDirectory(projects, "C:/Users/Alice/Project")?.id).toBe("drive")
  })

  test("keeps POSIX path matching case-sensitive", () => {
    const projects = [project("app", "/Users/Alice/Project")]

    expect(resolveProjectForDirectory(projects, "/users/Alice/Project/src")).toBeNull()
  })
})

describe("resolveProjectForSessionDirectory", () => {
  test("resolves Windows worktree paths case-insensitively", () => {
    const projects = [project("app", "C:/Users/Alice/Project")]
    const worktrees = new Map<string, WorktreeMetadata[]>([
      ["C:/Users/Alice/Project", [worktree("C:/Users/Alice/Project/.worktrees/Feature", "C:/Users/Alice/Project")]],
    ])

    expect(resolveProjectForSessionDirectory(projects, worktrees, "c:/Users/Alice/Project/.worktrees/Feature/src")?.id).toBe(
      "app",
    )
  })
})
