import { describe, expect, test } from "bun:test"
import {
  footerMcpView,
  footerPermissionLabel,
  footerSessionStatusLabel,
  footerSandboxView,
  footerTrustChip,
} from "../../../src/cli/cmd/tui/routes/session/footer-view-model"
import {
  sessionHeaderContextLabel,
  sessionHeaderLayout,
  sessionHeaderWorkspaceLabel,
} from "../../../src/cli/cmd/tui/routes/session/header-view-model"

describe("tui session header/footer view models", () => {
  test("derives header context label without renderer state", () => {
    expect(
      sessionHeaderContextLabel({
        totalTokens: 12_345,
        contextLimit: 100_000,
        outputTokens: 600,
        createdAt: 1_000,
        completedAt: 31_000,
      }),
    ).toBe("12,345  12%  20 tok/s")

    expect(sessionHeaderContextLabel({ totalTokens: undefined })).toBeUndefined()
  })

  test("keeps header token rate when timestamps start at zero", () => {
    expect(
      sessionHeaderContextLabel({
        totalTokens: 100,
        outputTokens: 50,
        createdAt: 0,
        completedAt: 10_000,
      }),
    ).toBe("100  5 tok/s")
  })

  test("derives header workspace label without renderer state", () => {
    expect(
      sessionHeaderWorkspaceLabel({
        sessionDirectory: "/repo",
        localDirectory: "/repo",
      }),
    ).toBe("Workspace local")

    expect(
      sessionHeaderWorkspaceLabel({
        sessionDirectory: "/worktree",
        localDirectory: "/repo",
      }),
    ).toBe("Workspace /worktree")

    expect(
      sessionHeaderWorkspaceLabel({
        sessionDirectory: "/worktree",
        localDirectory: "/repo",
        workspaceName: "feature-a",
      }),
    ).toBe("Workspace feature-a")
  })

  test("derives header responsive layout without terminal renderer hooks", () => {
    expect(sessionHeaderLayout({ terminalWidth: 140 })).toEqual({ sidebarWidth: 42, narrow: true })
    expect(sessionHeaderLayout({ terminalWidth: 160 })).toEqual({ sidebarWidth: 42, narrow: false })
    expect(sessionHeaderLayout({ terminalWidth: 100 })).toEqual({ sidebarWidth: 0, narrow: false })
  })

  test("derives footer chip labels without renderer state", () => {
    expect(footerPermissionLabel(0)).toBeUndefined()
    expect(footerPermissionLabel(1)).toBe("1 Permission")
    expect(footerPermissionLabel(2)).toBe("2 Permissions")
    expect(footerSessionStatusLabel({ status: { type: "idle" }, now: 10_000 })).toBeUndefined()
    expect(
      footerSessionStatusLabel({
        status: { type: "busy", waitState: "llm", startedAt: 2_000 },
        now: 10_000,
      }),
    ).toBe("Waiting for model · 8s")
    expect(
      footerSessionStatusLabel({
        status: { type: "busy", waitState: "tool", activeTool: "code_intelligence", startedAt: 8_000 },
        now: 10_000,
      }),
    ).toBe("Running Code Intelligence · 2s")
    expect(
      footerSessionStatusLabel({
        status: { type: "retry", attempt: 1, message: "retry", next: 18_000 },
        now: 10_000,
      }),
    ).toBe("Retrying in 8s")

    expect(footerTrustChip({ experimentalDebugEngine: false, pendingPlans: 0, graphNodeCount: 10 })).toBeUndefined()
    expect(footerTrustChip({ experimentalDebugEngine: true, pendingPlans: 0, graphNodeCount: 10 })).toEqual({
      type: "ready",
      label: "Trust ready",
      count: 0,
    })
    expect(footerTrustChip({ experimentalDebugEngine: false, pendingPlans: 2, graphNodeCount: 0 })).toEqual({
      type: "plans",
      label: "2 Plans",
      count: 2,
    })
  })

  test("derives footer MCP and sandbox state without renderer colors", () => {
    expect(footerMcpView(["connected", "failed", "connected"])).toEqual({ connected: 2, hasError: true })
    expect(footerSandboxView("full-access")).toEqual({ label: "sandbox off", risk: "danger" })
    expect(footerSandboxView("workspace-write")).toEqual({ label: "sandbox on", risk: "safe" })
  })
})
