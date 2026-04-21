import { describe, expect, test } from "bun:test"
import { registerSyncLifecycle } from "../../../src/cli/cmd/tui/context/sync-lifecycle"
import { createSyncStartupCoordinator } from "../../../src/cli/cmd/tui/context/sync-startup"
import { RECONNECT_STABILIZE_MS } from "../../../src/cli/cmd/tui/util/reconnect-recovery"

const STABILIZE_WAIT = RECONNECT_STABILIZE_MS + 50

describe("tui sync startup flow", () => {
  test("root cleanup before mount cancels a pending reconnect recovery", async () => {
    const rootCleanups: Array<() => void> = []
    let watchConnection: ((connected: boolean) => void) | undefined
    let bootstrapStarts = 0
    let reconnectRecoveries = 0

    const startupCoordinator = createSyncStartupCoordinator({
      runBootstrapInBackground() {
        bootstrapStarts++
      },
      debugEngineEnabled: false,
      pollDebugEngine: () => undefined,
      recoverBootstrap: async () => {
        reconnectRecoveries++
      },
    })

    registerSyncLifecycle({
      onMount: () => undefined,
      onCleanup(callback) {
        rootCleanups.push(callback)
      },
      watchConnection(_source, onChange) {
        watchConnection = onChange
      },
      unsubscribeEvents: () => undefined,
      sseConnected: () => false,
      startupCoordinator,
    })

    // Simulate a reconnect sequence before the mount callback ever runs.
    watchConnection?.(true)
    watchConnection?.(false)
    watchConnection?.(true)

    // Dispose the provider before the reconnect stabilization delay elapses.
    rootCleanups[0]?.()
    await Bun.sleep(STABILIZE_WAIT)

    expect(bootstrapStarts).toBe(0)
    expect(reconnectRecoveries).toBe(0)
  })
})
