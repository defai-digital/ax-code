import { describe, expect, test } from "vitest"
import type { ProjectEntry } from "@/lib/api/types"
import type { WorktreeMetadata } from "@/types/worktree"
import { buildSessionMoveTargets } from "./sessionMoveDialogModel"

const projects: ProjectEntry[] = [
  { id: "proj-a", path: "/repo/a", label: "Repo A" },
  { id: "proj-b", path: "/repo/b", label: "Repo B" },
]

function worktree(input: Partial<WorktreeMetadata> & Pick<WorktreeMetadata, "path">): WorktreeMetadata {
  return {
    projectDirectory: "/repo/a",
    branch: "main",
    label: input.path.split("/").at(-1) ?? input.path,
    ...input,
  }
}

describe("buildSessionMoveTargets", () => {
  test("builds project root and same-project worktree targets", () => {
    const targets = buildSessionMoveTargets({
      projects,
      currentDirectory: "/repo/a/feature-one",
      availableWorktreesByProject: new Map([
        [
          "/repo/a",
          [
            worktree({ path: "/repo/a/feature-one", label: "Feature One", branch: "feature/one" }),
            worktree({
              path: "/repo/a/feature-two",
              label: "Feature Two",
              branch: "feature/two",
              status: { isDirty: true },
            }),
            worktree({ path: "/repo/a/feature-two", label: "Duplicate", branch: "duplicate" }),
          ],
        ],
        ["/repo/b", [worktree({ path: "/repo/b/other", projectDirectory: "/repo/b", label: "Other" })]],
      ]),
    })

    expect(targets.map((target) => target.path)).toEqual(["/repo/a", "/repo/a/feature-one", "/repo/a/feature-two"])
    expect(targets.find((target) => target.path === "/repo/a/feature-one")?.current).toBe(true)
    expect(targets.find((target) => target.path === "/repo/a/feature-two")?.dirty).toBe(true)
  })

  test("falls back to the current directory when no project matches", () => {
    const targets = buildSessionMoveTargets({
      projects,
      currentDirectory: "/tmp/standalone",
      availableWorktreesByProject: new Map(),
    })

    expect(targets).toEqual([
      {
        id: "/tmp/standalone",
        path: "/tmp/standalone",
        label: "standalone",
        description: "Current directory",
        branch: null,
        dirty: false,
        current: true,
      },
    ])
  })
})
