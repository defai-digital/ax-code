import { describe, expect, test } from "vitest"
import type { GitStatus } from "@/lib/api/types"

import { getFileStatusForPath, getFolderBadgeForPath } from "./fileStatus"

const gitStatus = (files: GitStatus["files"]): GitStatus => ({ files }) as GitStatus

describe("file git status helpers", () => {
  test("matches Windows file status paths case-insensitively against the root", () => {
    expect(
      getFileStatusForPath("c:/users/alice/project/src/app.ts", {
        root: "C:/Users/Alice/Project",
        isOpen: () => false,
        gitStatus: gitStatus([{ path: "src/app.ts", index: "M", working_dir: " " }]),
      }),
    ).toBe("git-modified")
  })

  test("matches Windows folder badges case-insensitively against the root", () => {
    expect(
      getFolderBadgeForPath("c:/users/alice/project/src", {
        root: "C:/Users/Alice/Project",
        gitStatus: gitStatus([
          { path: "src/app.ts", index: "M", working_dir: " " },
          { path: "src/new.ts", index: "A", working_dir: " " },
          { path: "src2/other.ts", index: "M", working_dir: " " },
        ]),
      }),
    ).toEqual({ modified: 1, added: 1 })
  })

  test("does not match sibling folder prefixes for badges", () => {
    expect(
      getFolderBadgeForPath("/repo/src", {
        root: "/repo",
        gitStatus: gitStatus([{ path: "src2/other.ts", index: "M", working_dir: " " }]),
      }),
    ).toBeNull()
  })
})
