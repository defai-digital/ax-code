import { describe, expect, test } from "bun:test"
import {
  AX_CODE_TUI_RUNTIME_SYNC_PROBE_DELAY_MS,
  createRuntimeSyncProbeScheduler,
  handleRuntimeSyncEvent,
} from "../../../src/cli/cmd/tui/context/sync-runtime-event"

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0))

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

  test("routes runtime probe refreshes through the scheduler when provided", () => {
    const calls: string[] = []
    const scheduled: string[] = []

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
        scheduleProbe(task) {
          scheduled.push(task.key)
        },
      },
    )

    expect(handled).toBe(true)
    expect(calls).toEqual([])
    expect(scheduled).toEqual(["lsp", "debug-engine"])
  })

  test("coalesces scheduled runtime probes by key", async () => {
    const calls: string[] = []
    const coalesced: string[] = []
    let flush = () => {}
    const scheduler = createRuntimeSyncProbeScheduler({
      delayMs: 100,
      onCoalesced(key) {
        coalesced.push(key)
      },
      setTimeoutFn(handler) {
        flush = handler
        return 1 as unknown as ReturnType<typeof setTimeout>
      },
      clearTimeoutFn: () => undefined,
    })

    scheduler.schedule({
      key: "debug-engine",
      label: "debug first failed",
      run: () => {
        calls.push("debug:first")
      },
      onWarn: () => undefined,
    })
    scheduler.schedule({
      key: "debug-engine",
      label: "debug latest failed",
      run: () => {
        calls.push("debug:latest")
      },
      onWarn: () => undefined,
    })
    scheduler.schedule({
      key: "mcp",
      label: "mcp failed",
      run: () => {
        calls.push("mcp")
      },
      onWarn: () => undefined,
    })

    expect(calls).toEqual([])
    expect(coalesced).toEqual(["debug-engine"])
    flush()
    await Promise.resolve()

    expect(calls).toEqual(["debug:latest", "mcp"])
  })

  test("keeps runtime probes single-flight per key and reruns only the latest queued probe", async () => {
    const calls: string[] = []
    const coalesced: string[] = []
    let flush = () => {}
    let releaseFirst = () => {}
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const scheduler = createRuntimeSyncProbeScheduler({
      delayMs: 100,
      onCoalesced(key) {
        coalesced.push(key)
      },
      setTimeoutFn(handler) {
        flush = handler
        return 1 as unknown as ReturnType<typeof setTimeout>
      },
      clearTimeoutFn: () => undefined,
    })

    scheduler.schedule({
      key: "lsp",
      label: "lsp first failed",
      run: async () => {
        calls.push("lsp:first:start")
        await firstGate
        calls.push("lsp:first:finish")
      },
      onWarn: () => undefined,
    })
    flush()
    await Promise.resolve()

    scheduler.schedule({
      key: "lsp",
      label: "lsp second failed",
      run: () => {
        calls.push("lsp:second")
      },
      onWarn: () => undefined,
    })
    scheduler.schedule({
      key: "lsp",
      label: "lsp latest failed",
      run: () => {
        calls.push("lsp:latest")
      },
      onWarn: () => undefined,
    })

    expect(calls).toEqual(["lsp:first:start"])
    expect(coalesced).toEqual(["lsp"])

    releaseFirst()
    await nextTick()
    expect(calls).toEqual(["lsp:first:start", "lsp:first:finish"])

    flush()
    await nextTick()
    expect(calls).toEqual(["lsp:first:start", "lsp:first:finish", "lsp:latest"])
  })

  test("uses the runtime probe delay support knob", () => {
    let scheduledDelay = -1
    const scheduler = createRuntimeSyncProbeScheduler({
      env: {
        [AX_CODE_TUI_RUNTIME_SYNC_PROBE_DELAY_MS]: "1234",
      },
      setTimeoutFn(_handler, timeout) {
        scheduledDelay = timeout
        return 1 as unknown as ReturnType<typeof setTimeout>
      },
      clearTimeoutFn: () => undefined,
    })

    scheduler.schedule({
      key: "lsp",
      label: "lsp failed",
      run: () => undefined,
      onWarn: () => undefined,
    })

    expect(scheduledDelay).toBe(1234)
  })

  test("dispose clears queued runtime probes before they run", () => {
    let flush = () => {}
    let cleared = 0
    const calls: string[] = []
    const scheduler = createRuntimeSyncProbeScheduler({
      delayMs: 100,
      setTimeoutFn(handler) {
        flush = handler
        return 1 as unknown as ReturnType<typeof setTimeout>
      },
      clearTimeoutFn: () => {
        cleared++
      },
    })

    scheduler.schedule({
      key: "mcp",
      label: "mcp failed",
      run: () => {
        calls.push("mcp")
      },
      onWarn: () => undefined,
    })
    scheduler.dispose()
    flush()

    expect(cleared).toBe(1)
    expect(calls).toEqual([])
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
