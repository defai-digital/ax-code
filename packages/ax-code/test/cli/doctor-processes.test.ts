import { describe, expect, test } from "vitest"
import { getDoctorProcessRegistryCheck } from "../../src/cli/cmd/doctor-processes"
import type { ProcessRegistry } from "../../src/runtime/process-registry"

function listed(
  entry: Partial<ProcessRegistry.Entry> & { pid: number; kind: ProcessRegistry.Kind },
  state: ProcessRegistry.ListedState,
): ProcessRegistry.ListedProcess {
  return {
    state,
    file: `/state/processes/${entry.kind}-${entry.pid}.json`,
    entry: {
      pgid: entry.pid,
      startedAt: `start-${entry.pid}`,
      ownerPid: 4242,
      ownerStartedAt: "start-4242",
      commandBase: "sleep",
      ...entry,
    } as ProcessRegistry.Entry,
  }
}

function sweepReport(report: Partial<ProcessRegistry.SweepReport> = {}): ProcessRegistry.SweepReport {
  return {
    checked: 0,
    keptLiveOwner: 0,
    killed: 0,
    alreadyDead: 0,
    pidReused: 0,
    unverified: 0,
    invalidRemoved: 0,
    errors: [],
    ...report,
  }
}

describe("getDoctorProcessRegistryCheck", () => {
  test("reports an empty registry with the missing-sweep note", async () => {
    const check = await getDoctorProcessRegistryCheck({ list: async () => [], lastSweep: () => undefined })

    expect(check).toMatchObject({ name: "Child processes", status: "ok" })
    expect(check.detail).toContain("no registered child processes")
    expect(check.detail).toContain("startup sweep not recorded in this process")
  })

  test("lists registered children of live owners and the sweep summary", async () => {
    const check = await getDoctorProcessRegistryCheck({
      list: async () => [
        listed({ pid: 501, kind: "shell", commandBase: "cargo" }, "live-owner"),
        listed({ pid: 502, kind: "shell", commandBase: "npm" }, "live-owner"),
        listed({ pid: 503, kind: "lsp", commandBase: "clangd" }, "live-owner"),
      ],
      lastSweep: () => ({
        at: Date.now(),
        report: sweepReport({ checked: 5, killed: 1, alreadyDead: 2, keptLiveOwner: 2 }),
      }),
    })

    expect(check.status).toBe("ok")
    expect(check.detail).toContain("3 registered child process(es): 2 shell, 1 lsp — all owners alive")
    expect(check.detail).toContain("shell pid 501 (cargo)")
    expect(check.detail).toContain("lsp pid 503 (clangd)")
    expect(check.detail).toContain("startup sweep: 1 killed, 2 already dead, 0 pid-reuse skipped")
  })

  test("warns when orphaned or unverifiable entries remain after the sweep", async () => {
    const check = await getDoctorProcessRegistryCheck({
      list: async () => [
        listed({ pid: 610, kind: "shell" }, "orphan"),
        listed({ pid: 611, kind: "mcp", commandBase: "npx" }, "unverified"),
        listed({ pid: 612, kind: "lsp" }, "dead"),
        listed({ pid: 613, kind: "lsp" }, "live-owner"),
      ],
      lastSweep: () => ({ at: Date.now(), report: sweepReport({ checked: 4, keptLiveOwner: 1 }) }),
    })

    expect(check.status).toBe("warn")
    expect(check.detail).toContain("1 with live owners, 1 orphaned, 1 unverifiable, 1 stale")
    expect(check.detail).toContain("orphan: shell pid 610 (sleep)")
    expect(check.detail).toContain("unverified: mcp pid 611 (npx)")
    expect(check.detail).toContain("the startup sweep did not clear them")
  })

  test("warns when the sweep itself reported errors", async () => {
    const check = await getDoctorProcessRegistryCheck({
      list: async () => [],
      lastSweep: () => ({ at: Date.now(), report: sweepReport({ errors: ["EACCES"] }) }),
    })

    expect(check.status).toBe("warn")
    expect(check.detail).toContain("sweep reported 1 error(s)")
  })

  test("notes the disabled registry on windows without a sweep line", async () => {
    const check = await getDoctorProcessRegistryCheck({
      platform: "win32",
      list: async () => [],
      lastSweep: () => ({ at: Date.now(), report: sweepReport({ skipped: "non-posix" }) }),
    })

    expect(check.status).toBe("ok")
    expect(check.detail).toContain("child process registry disabled (windows)")
    expect(check.detail).toContain("(skipped on windows)")
    expect(check.detail).not.toContain("startup sweep not recorded")
  })

  test("bounds the per-entry listing", async () => {
    const entries = Array.from({ length: 11 }, (_, index) => listed({ pid: 700 + index, kind: "shell" }, "live-owner"))
    const check = await getDoctorProcessRegistryCheck({ list: async () => entries, lastSweep: () => undefined })

    expect(check.status).toBe("ok")
    expect(check.detail).toContain("11 registered child process(es)")
    expect(check.detail).toContain("shell pid 707 (sleep)")
    expect(check.detail).toContain("+3 more")
  })
})
