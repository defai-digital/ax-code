import { describe, expect, test } from "vitest"
import {
  AX_CODE_WORKSPACE_HEADER,
  LEGACY_OPENCODE_WORKSPACE_HEADER,
  withWorkspaceHeaders,
  workspaceHeaderValue,
} from "../../src/util/workspace-headers"

describe("util.workspace-headers", () => {
  test("prefers the current workspace header and falls back to the legacy header", () => {
    expect(
      workspaceHeaderValue((name) =>
        name === AX_CODE_WORKSPACE_HEADER
          ? "wrk_current"
          : name === LEGACY_OPENCODE_WORKSPACE_HEADER
            ? "wrk_legacy"
            : undefined,
      ),
    ).toBe("wrk_current")

    expect(workspaceHeaderValue((name) => (name === LEGACY_OPENCODE_WORKSPACE_HEADER ? "wrk_legacy" : undefined))).toBe(
      "wrk_legacy",
    )
  })

  test("mirrors workspace ids across current and legacy header names", () => {
    expect(withWorkspaceHeaders({ accept: "text/event-stream" }, "wrk_test")).toEqual({
      accept: "text/event-stream",
      [AX_CODE_WORKSPACE_HEADER]: "wrk_test",
      [LEGACY_OPENCODE_WORKSPACE_HEADER]: "wrk_test",
    })
  })
})
