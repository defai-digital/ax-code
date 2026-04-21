import { describe, expect, test } from "bun:test"
import { createInitialSyncState } from "../../../src/cli/cmd/tui/context/sync-state"

describe("tui sync state", () => {
  test("creates the expected initial sync store defaults", () => {
    expect(createInitialSyncState()).toEqual({
      provider_next: {
        all: [],
        default: {},
        connected: [],
      },
      session_loaded: false,
      provider_loaded: false,
      provider_failed: false,
      provider_auth: {},
      config: {},
      status: "loading",
      agent: [],
      permission: {},
      question: {},
      command: [],
      provider: [],
      provider_default: {},
      session: [],
      session_status: {},
      session_diff: {},
      todo: {},
      message: {},
      part: {},
      lsp: [],
      debugEngine: {
        pendingPlans: 0,
        plans: [],
        toolCount: 0,
        graph: {
          nodeCount: 0,
          edgeCount: 0,
          lastIndexedAt: null,
          state: "idle",
          completed: 0,
          total: 0,
          error: null,
        },
      },
      isolation: { mode: "workspace-write", network: false },
      autonomous: true,
      smartLlm: false,
      mcp: {},
      mcp_resource: {},
      formatter: [],
      vcs: undefined,
      path: { state: "", config: "", worktree: "", directory: "" },
      workspaceList: [],
    })
  })
})
