import { describe, expect, test } from "vitest"
import {
  AX_CODE_TUI_RUNTIME_SYNC_PROBE_DELAY_MS,
  createRuntimeSyncProbeScheduler,
  runtimeSyncProbeTask,
} from "../../../src/cli/cmd/tui/context/sync-runtime-probe"

describe("tui sync runtime probe", () => {
  test("creates labeled runtime probe tasks from headless probe keys", async () => {
    const calls: string[] = []
    const warnings: Array<{ label: string; error: unknown }> = []
    const mcp = runtimeSyncProbeTask("mcp", {
      syncMcpStatus: () => {
        calls.push("mcp")
      },
      syncLspStatus: () => undefined,
      syncDebugEngine: () => undefined,
      onWarn(label, error) {
        warnings.push({ label, error })
      },
    })

    await mcp.run()

    expect(mcp.label).toBe("mcp status sync failed")
    expect(calls).toEqual(["mcp"])
    expect(warnings).toEqual([])

    const workflow = runtimeSyncProbeTask("workflow", {
      syncMcpStatus: () => undefined,
      syncLspStatus: () => undefined,
      syncDebugEngine: () => undefined,
      syncWorkflowDashboard: () => {
        calls.push("workflow")
      },
      onWarn(label, error) {
        warnings.push({ label, error })
      },
    })

    await workflow.run()

    expect(workflow.label).toBe("workflow dashboard sync failed")
    expect(calls).toEqual(["mcp", "workflow"])
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

  test("uses the environment delay when it is valid and ignores invalid values", () => {
    const timers: number[] = []
    const valid = createRuntimeSyncProbeScheduler({
      env: {
        [AX_CODE_TUI_RUNTIME_SYNC_PROBE_DELAY_MS]: "25",
      },
      setTimeoutFn(_handler, timeout) {
        timers.push(timeout)
        return 1 as unknown as ReturnType<typeof setTimeout>
      },
      clearTimeoutFn: () => undefined,
    })
    valid.schedule({ key: "mcp", label: "mcp", run: () => undefined, onWarn: () => undefined })

    const invalid = createRuntimeSyncProbeScheduler({
      env: {
        [AX_CODE_TUI_RUNTIME_SYNC_PROBE_DELAY_MS]: "-1",
      },
      setTimeoutFn(_handler, timeout) {
        timers.push(timeout)
        return 1 as unknown as ReturnType<typeof setTimeout>
      },
      clearTimeoutFn: () => undefined,
    })
    invalid.schedule({ key: "mcp", label: "mcp", run: () => undefined, onWarn: () => undefined })

    expect(timers).toEqual([25, 750])
  })
})
