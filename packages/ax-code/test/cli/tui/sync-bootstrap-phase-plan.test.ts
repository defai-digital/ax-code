import { describe, expect, test } from "bun:test"
import { createSyncBootstrapPhaseSequence } from "../../../src/cli/cmd/tui/context/sync-bootstrap-phase-plan"
import { runBootstrapPhaseSequence } from "../../../src/cli/cmd/tui/context/sync-bootstrap-runner"

describe("tui sync bootstrap phase plan", () => {
  test("applies status transitions, startup markers, spans, and labeled logging across bootstrap phases", async () => {
    const logs: Array<{ level: "warn" | "error"; label: string; error: string }> = []
    const startup: Array<{ name: string; data?: Record<string, unknown> }> = []
    const spans: Array<{ phase: "core" | "deferred"; data?: Record<string, unknown> }> = []
    const statuses: string[] = []
    let status: "loading" | "partial" | "complete" = "loading"
    let startupFinished = 0

    await runBootstrapPhaseSequence(
      createSyncBootstrapPhaseSequence({
        blockingTasks: [() => Promise.reject(new Error("blocking failed"))],
        coreTasks: [() => Promise.reject(new Error("core failed"))],
        deferredTasks: [() => Promise.reject(new Error("deferred failed"))],
        getStatus: () => status,
        setStatus(next) {
          status = next
          statuses.push(next)
        },
        finishCoreSpan(data) {
          spans.push({ phase: "core", data })
        },
        finishDeferredSpan(data) {
          spans.push({ phase: "deferred", data })
        },
        finishStartup() {
          startupFinished++
        },
        logWarn(label, data) {
          logs.push({ level: "warn", label, error: data.error })
        },
        logError(label, data) {
          logs.push({ level: "error", label, error: data.error })
        },
        recordStartup(name, data) {
          startup.push({ name, data })
        },
      }),
    )

    expect(statuses).toEqual(["partial", "complete"])
    expect(startupFinished).toBe(1)
    expect(logs).toEqual([
      { level: "warn", label: "blocking bootstrap item failed", error: "Error: blocking failed" },
      { level: "error", label: "core bootstrap item failed", error: "Error: core failed" },
      { level: "error", label: "deferred bootstrap item failed", error: "Error: deferred failed" },
    ])
    expect(startup).toEqual([
      { name: "tui.startup.syncPartial", data: undefined },
      { name: "tui.startup.bootstrapCoreReady", data: { rejected: 1 } },
      { name: "tui.startup.bootstrapDeferredReady", data: { rejected: 1 } },
    ])
    expect(spans).toEqual([
      { phase: "core", data: { rejected: 1 } },
      { phase: "deferred", data: { rejected: 1 } },
    ])
  })

  test("does not emit the partial-ready marker when bootstrap has already left loading", async () => {
    const startup: string[] = []
    let status: "loading" | "partial" | "complete" = "partial"

    await runBootstrapPhaseSequence(
      createSyncBootstrapPhaseSequence({
        blockingTasks: [() => Promise.resolve()],
        coreTasks: [],
        deferredTasks: [],
        getStatus: () => status,
        setStatus(next) {
          status = next
        },
        finishStartup() {},
        logWarn: () => undefined,
        logError: () => undefined,
        recordStartup(name) {
          startup.push(name)
        },
      }),
    )

    expect(startup).toEqual(["tui.startup.bootstrapCoreReady", "tui.startup.bootstrapDeferredReady"])
    expect(status as string).toBe("complete")
  })

  test("does not mark bootstrap partial when there are no blocking tasks", async () => {
    const startup: string[] = []
    const statuses: string[] = []
    let status: "loading" | "partial" | "complete" = "loading"

    await runBootstrapPhaseSequence(
      createSyncBootstrapPhaseSequence({
        blockingTasks: [],
        coreTasks: [() => Promise.resolve()],
        deferredTasks: [],
        getStatus: () => status,
        setStatus(next) {
          status = next
          statuses.push(next)
        },
        finishStartup() {},
        logWarn: () => undefined,
        logError: () => undefined,
        recordStartup(name) {
          startup.push(name)
        },
      }),
    )

    expect(statuses).toEqual(["complete"])
    expect(startup).toEqual(["tui.startup.bootstrapCoreReady", "tui.startup.bootstrapDeferredReady"])
    expect(status as string).toBe("complete")
  })
})
