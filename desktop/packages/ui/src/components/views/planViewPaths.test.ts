import { describe, expect, test } from "vitest"

import {
  buildRepoPlanPath,
  resolvePlanProjectRefForDirectory,
  toPlanDisplayPath,
} from "./planViewPaths"

describe("PlanView path helpers", () => {
  test("displays Windows plan paths relative to the session directory when casing differs", () => {
    expect(
      toPlanDisplayPath("c:/users/alice/project/.ax-code/plans/123-plan.md", {
        currentDirectory: "C:/Users/Alice/Project",
        homeDirectory: "C:/Users/Alice",
      }),
    ).toBe(".ax-code/plans/123-plan.md")
  })

  test("displays UNC plan paths relative to the session directory when casing differs", () => {
    expect(
      toPlanDisplayPath("//SERVER/Share/Project/.ax-code/plans/123-plan.md", {
        currentDirectory: "//server/share/project",
        homeDirectory: "//server/share/home",
      }),
    ).toBe(".ax-code/plans/123-plan.md")
  })

  test("keeps POSIX session-directory matching case-sensitive", () => {
    expect(
      toPlanDisplayPath("/users/alice/project/.ax-code/plans/123-plan.md", {
        currentDirectory: "/Users/Alice/Project",
        homeDirectory: "/Users/Alice",
      }),
    ).toBe("/users/alice/project/.ax-code/plans/123-plan.md")
  })

  test("does not trim sibling directory prefixes from display paths", () => {
    expect(
      toPlanDisplayPath("/repo/project-other/.ax-code/plans/123-plan.md", {
        currentDirectory: "/repo/project",
        homeDirectory: "/home/alice",
      }),
    ).toBe("/repo/project-other/.ax-code/plans/123-plan.md")
  })

  test("resolves the active Windows project when the directory casing differs", () => {
    expect(
      resolvePlanProjectRefForDirectory(
        "c:/users/alice/project/worktree",
        [
          { id: "other", path: "C:/Users/Alice/ProjectOther" },
          { id: "active", path: "C:/Users/Alice/Project" },
        ],
        "active",
      ),
    ).toEqual({ id: "active", path: "C:/Users/Alice/Project" })
  })

  test("chooses the longest matching project without using sibling prefixes", () => {
    expect(
      resolvePlanProjectRefForDirectory(
        "/repo/project/packages/ui",
        [
          { id: "root", path: "/repo/project" },
          { id: "ui", path: "/repo/project/packages/ui" },
          { id: "sibling", path: "/repo/project/packages/ui-old" },
        ],
        null,
      ),
    ).toEqual({ id: "ui", path: "/repo/project/packages/ui" })
  })

  test("builds repository plan paths under Windows drive roots without duplicate slashes", () => {
    expect(buildRepoPlanPath("C:/", 123, "plan")).toBe("C:/.ax-code/plans/123-plan.md")
  })
})
