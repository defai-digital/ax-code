import { describe, expect, test } from "bun:test"
import { createSyncStartupCoordinator } from "../../../src/cli/cmd/tui/context/sync-startup"

describe("tui sync startup coordinator", () => {
  test("starts bootstrap once and clears the debug-engine poll on stop", () => {
    const calls = {
      bootstrap: 0,
      poll: 0,
      cleared: [] as string[],
    }
    const intervalHandles: string[] = []

    const coordinator = createSyncStartupCoordinator({
      runBootstrapInBackground() {
        calls.bootstrap++
      },
      debugEngineEnabled: true,
      pollDebugEngine() {
        calls.poll++
      },
      recoverBootstrap: () => undefined,
      pollIntervalMs: 2_500,
      setIntervalFn(handler, timeout) {
        expect(timeout).toBe(2_500)
        intervalHandles.push("poll-handle")
        handler()
        return "poll-handle" as unknown as ReturnType<typeof setInterval>
      },
      clearIntervalFn(handle) {
        calls.cleared.push(String(handle))
      },
    })

    coordinator.start()
    coordinator.start()
    coordinator.stop()
    coordinator.stop()

    expect(calls.bootstrap).toBe(1)
    expect(calls.poll).toBe(1)
    expect(intervalHandles).toEqual(["poll-handle"])
    expect(calls.cleared).toEqual(["poll-handle"])
  })

  test("skips debug-engine polling when the feature flag is disabled", () => {
    let bootstrapCalls = 0
    let intervalCalls = 0

    const coordinator = createSyncStartupCoordinator({
      runBootstrapInBackground() {
        bootstrapCalls++
      },
      debugEngineEnabled: false,
      pollDebugEngine: () => undefined,
      recoverBootstrap: () => undefined,
      setIntervalFn() {
        intervalCalls++
        return "unexpected" as unknown as ReturnType<typeof setInterval>
      },
    })

    coordinator.start()
    coordinator.stop()

    expect(bootstrapCalls).toBe(1)
    expect(intervalCalls).toBe(0)
  })

  test("forwards connection changes to the reconnect recovery gate", () => {
    const forwarded: boolean[] = []
    const recoverCalls: Array<() => Promise<void> | void> = []

    const coordinator = createSyncStartupCoordinator({
      runBootstrapInBackground: () => undefined,
      debugEngineEnabled: false,
      pollDebugEngine: () => undefined,
      recoverBootstrap: () => undefined,
      createReconnectGate(input) {
        recoverCalls.push(input.recover)
        return {
          onConnectionChange(connected) {
            forwarded.push(connected)
          },
        }
      },
    })

    coordinator.onConnectionChange(true)
    coordinator.onConnectionChange(false)

    expect(recoverCalls).toHaveLength(1)
    expect(forwarded).toEqual([true, false])
  })

  test("disposes the reconnect gate on stop and recreates it on restart", () => {
    const disposed: string[] = []
    const created: number[] = []
    let gateID = 0

    const coordinator = createSyncStartupCoordinator({
      runBootstrapInBackground: () => undefined,
      debugEngineEnabled: false,
      pollDebugEngine: () => undefined,
      recoverBootstrap: () => undefined,
      createReconnectGate() {
        const id = ++gateID
        created.push(id)
        return {
          onConnectionChange() {},
          dispose() {
            disposed.push(`gate:${id}`)
          },
        }
      },
    })

    coordinator.start()
    coordinator.stop()
    coordinator.start()
    coordinator.stop()

    expect(created).toEqual([1, 2])
    expect(disposed).toEqual(["gate:1", "gate:2"])
  })
})
