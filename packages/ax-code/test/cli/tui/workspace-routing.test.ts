import { describe, expect, test } from "bun:test"
import {
  currentWorkspaceSelection,
  LOCAL_WORKSPACE_ID,
  localWorkspaceDirectory,
} from "../../../src/cli/cmd/tui/component/workspace/local-workspace"

describe("tui workspace routing", () => {
  test("keeps local workspace anchored to the initial directory", () => {
    expect(
      localWorkspaceDirectory({
        baseDirectory: "/repo",
        fallbackDirectory: "/repo/worktrees/feature",
      }),
    ).toBe("/repo")
  })

  test("selects the explicit home workspace when present", () => {
    expect(
      currentWorkspaceSelection({
        routeType: "home",
        homeWorkspaceID: "/repo/worktrees/feature",
        localDirectory: "/repo",
      }),
    ).toBe("/repo/worktrees/feature")
  })

  test("does not collapse non-local session workspaces into local", () => {
    expect(
      currentWorkspaceSelection({
        routeType: "session",
        sessionDirectory: "/repo/worktrees/feature",
        localDirectory: "/repo",
      }),
    ).toBe("/repo/worktrees/feature")
  })

  test("falls back to local when the session matches the base directory", () => {
    expect(
      currentWorkspaceSelection({
        routeType: "session",
        sessionDirectory: "/repo",
        localDirectory: "/repo",
      }),
    ).toBe(LOCAL_WORKSPACE_ID)
  })
})
