import { describe, expect, test } from "bun:test"
import { directoryLabel } from "../../../src/cli/cmd/tui/context/directory-view-model"

describe("tui directory view model", () => {
  test("shortens home paths and appends the active branch", () => {
    expect(
      directoryLabel({
        directory: "/Users/tester/code/ax-code",
        fallbackDirectory: "/tmp/fallback",
        homeDirectory: "/Users/tester",
        branch: "main",
      }),
    ).toBe("~/code/ax-code:main")
  })

  test("falls back to the current working directory when sync state is empty", () => {
    expect(
      directoryLabel({
        directory: "",
        fallbackDirectory: "/repo",
        homeDirectory: "/Users/tester",
      }),
    ).toBe("/repo")
  })

  test("leaves non-home directories unchanged", () => {
    expect(
      directoryLabel({
        directory: "/srv/worktree",
        fallbackDirectory: "/tmp/fallback",
        homeDirectory: "/Users/tester",
        branch: "release",
      }),
    ).toBe("/srv/worktree:release")
  })
})
