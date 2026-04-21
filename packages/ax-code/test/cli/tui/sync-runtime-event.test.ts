import { describe, expect, test } from "bun:test"
import { handleRuntimeSyncEvent } from "../../../src/cli/cmd/tui/context/sync-runtime-event"

describe("tui sync runtime event", () => {
  test("refreshes MCP status and warns on failure", async () => {
    const warnings: Array<{ label: string; error: unknown }> = []

    const handled = handleRuntimeSyncEvent(
      { type: "mcp.tools.changed" },
      {
        syncMcpStatus: async () => {
          throw new Error("mcp failed")
        },
        syncLspStatus: () => undefined,
        syncDebugEngine: () => undefined,
        setVcsBranch: () => undefined,
        onWarn(label, error) {
          warnings.push({ label, error })
        },
      },
    )

    await Promise.resolve()

    expect(handled).toBe(true)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.label).toBe("mcp status sync failed")
  })

  test("refreshes both LSP and debug-engine on lsp updates", async () => {
    const calls: string[] = []

    const handled = handleRuntimeSyncEvent(
      { type: "lsp.updated" },
      {
        syncMcpStatus: () => undefined,
        syncLspStatus: () => {
          calls.push("lsp")
        },
        syncDebugEngine: () => {
          calls.push("debug")
        },
        setVcsBranch: () => undefined,
        onWarn: () => undefined,
      },
    )

    expect(handled).toBe(true)
    expect(calls).toEqual(["lsp", "debug"])
  })

  test("warns when debug-engine refresh fails during lsp updates", async () => {
    const warnings: Array<{ label: string; error: unknown }> = []

    const handled = handleRuntimeSyncEvent(
      { type: "lsp.updated" },
      {
        syncMcpStatus: () => undefined,
        syncLspStatus: () => undefined,
        syncDebugEngine: async () => {
          throw new Error("debug failed")
        },
        setVcsBranch: () => undefined,
        onWarn(label, error) {
          warnings.push({ label, error })
        },
      },
    )

    await Promise.resolve()

    expect(handled).toBe(true)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.label).toBe("debug engine sync failed")
  })

  test("warns when debug-engine refresh throws synchronously during lsp updates", async () => {
    const warnings: Array<{ label: string; error: unknown }> = []

    const handled = handleRuntimeSyncEvent(
      { type: "lsp.updated" },
      {
        syncMcpStatus: () => undefined,
        syncLspStatus: () => undefined,
        syncDebugEngine: () => {
          throw new Error("debug sync throw")
        },
        setVcsBranch: () => undefined,
        onWarn(label, error) {
          warnings.push({ label, error })
        },
      },
    )

    await Promise.resolve()

    expect(handled).toBe(true)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.label).toBe("debug engine sync failed")
  })

  test("refreshes debug-engine on code-index events", () => {
    const calls: string[] = []

    handleRuntimeSyncEvent(
      { type: "code.index.state" },
      {
        syncMcpStatus: () => undefined,
        syncLspStatus: () => undefined,
        syncDebugEngine: () => {
          calls.push("debug")
        },
        setVcsBranch: () => undefined,
        onWarn: () => undefined,
      },
    )

    expect(calls).toEqual(["debug"])
  })

  test("warns when debug-engine refresh fails during code-index events", async () => {
    const warnings: Array<{ label: string; error: unknown }> = []

    const handled = handleRuntimeSyncEvent(
      { type: "code.index.state" },
      {
        syncMcpStatus: () => undefined,
        syncLspStatus: () => undefined,
        syncDebugEngine: async () => {
          throw new Error("debug failed")
        },
        setVcsBranch: () => undefined,
        onWarn(label, error) {
          warnings.push({ label, error })
        },
      },
    )

    await Promise.resolve()

    expect(handled).toBe(true)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.label).toBe("debug engine sync failed")
  })

  test("warns when MCP refresh throws synchronously", async () => {
    const warnings: Array<{ label: string; error: unknown }> = []

    const handled = handleRuntimeSyncEvent(
      { type: "mcp.tools.changed" },
      {
        syncMcpStatus: () => {
          throw new Error("mcp sync throw")
        },
        syncLspStatus: () => undefined,
        syncDebugEngine: () => undefined,
        setVcsBranch: () => undefined,
        onWarn(label, error) {
          warnings.push({ label, error })
        },
      },
    )

    await Promise.resolve()

    expect(handled).toBe(true)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.label).toBe("mcp status sync failed")
  })

  test("applies vcs branch updates", () => {
    const branches: string[] = []

    const handled = handleRuntimeSyncEvent(
      { type: "vcs.branch.updated", properties: { branch: "feature/test" } },
      {
        syncMcpStatus: () => undefined,
        syncLspStatus: () => undefined,
        syncDebugEngine: () => undefined,
        setVcsBranch(branch) {
          branches.push(branch)
        },
        onWarn: () => undefined,
      },
    )

    expect(handled).toBe(true)
    expect(branches).toEqual(["feature/test"])
  })
})
