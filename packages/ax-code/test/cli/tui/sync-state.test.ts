import { afterEach, describe, expect, test } from "bun:test"
import { createInitialSyncState } from "../../../src/cli/cmd/tui/context/sync-state"

afterEach(() => {
  delete process.env.AX_CODE_ISOLATION_MODE
  delete process.env.AX_CODE_ISOLATION_NETWORK
})

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
      stream_health: "connecting",
      permission: {},
      question: {},
      command: [],
      provider: [],
      provider_default: {},
      session: [],
      session_status: {},
      session_error: {},
      session_risk: {},
      session_goal: {},
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
      workflowDashboard: {
        runs: [],
        activeCount: 0,
        blockedCount: 0,
        terminalCount: 0,
        verificationEnvelopeCount: 0,
        evidenceRefCount: 0,
        exposedArtifactCount: 0,
      },
      isolation: { mode: "workspace-write", network: false },
      autonomous: true,
      smartLlm: false,
      superLong: false,
      mcp: {},
      mcp_resource: {},
      formatter: [],
      vcs: undefined,
      path: { home: "", state: "", config: "", worktree: "", directory: "" },
      workspaceList: [],
    })
  })

  test("seeds initial isolation from inherited sandbox flags", () => {
    process.env.AX_CODE_ISOLATION_MODE = "read-only"
    process.env.AX_CODE_ISOLATION_NETWORK = "false"

    expect(createInitialSyncState().isolation).toEqual({
      mode: "read-only",
      network: false,
    })

    process.env.AX_CODE_ISOLATION_MODE = "full-access"
    process.env.AX_CODE_ISOLATION_NETWORK = "true"

    expect(createInitialSyncState().isolation).toEqual({
      mode: "full-access",
      network: true,
    })
  })
})
