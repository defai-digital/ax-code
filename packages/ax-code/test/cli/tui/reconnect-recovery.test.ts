import { describe, expect, test } from "bun:test"
import { createReconnectRecoveryGate, RECONNECT_STABILIZE_MS } from "../../../src/cli/cmd/tui/util/reconnect-recovery"

// Wait long enough for the stabilization timer to fire.
const STABILIZE_WAIT = RECONNECT_STABILIZE_MS + 50

describe("createReconnectRecoveryGate", () => {
  test("skips the initial connect and recovers on the next reconnect", async () => {
    let calls = 0
    const gate = createReconnectRecoveryGate({
      recover: async () => {
        calls++
      },
    })

    gate.onConnectionChange(true)
    await gate.waitForIdle()
    expect(calls).toBe(0)

    gate.onConnectionChange(false)
    gate.onConnectionChange(true)
    await Bun.sleep(STABILIZE_WAIT)
    await gate.waitForIdle()

    expect(calls).toBe(1)
  })

  test("deduplicates rapid reconnect flaps into a single recovery", async () => {
    let calls = 0
    let release: (() => void) | undefined
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const gate = createReconnectRecoveryGate({
      recover: async () => {
        calls++
        if (calls === 1) await pending
      },
    })

    // Initial connect
    gate.onConnectionChange(true)
    // Rapid flaps: disconnect → reconnect → disconnect → reconnect
    gate.onConnectionChange(false)
    gate.onConnectionChange(true)
    gate.onConnectionChange(false)
    gate.onConnectionChange(true)

    // Stabilization timer fires only for the last reconnect
    await Bun.sleep(STABILIZE_WAIT)
    expect(calls).toBe(1)

    // Release first recovery — no second queued because the flaps
    // were deduplicated by the stabilization delay.
    release?.()
    await gate.waitForIdle()
    expect(calls).toBe(1)

    // A new clean reconnect cycle triggers a fresh recovery
    gate.onConnectionChange(false)
    gate.onConnectionChange(true)
    await Bun.sleep(STABILIZE_WAIT)
    await gate.waitForIdle()

    expect(calls).toBe(2)
  })

  test("re-runs recovery after an in-flight reconnect once the current pass finishes", async () => {
    const calls: string[] = []
    let releaseFirst: (() => void) | undefined
    const firstPass = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const gate = createReconnectRecoveryGate({
      recover: async () => {
        calls.push(`recover:${calls.length + 1}`)
        if (calls.length === 1) await firstPass
      },
    })

    // Initial connect + first reconnect
    gate.onConnectionChange(true)
    gate.onConnectionChange(false)
    gate.onConnectionChange(true)
    await Bun.sleep(STABILIZE_WAIT)
    expect(calls).toEqual(["recover:1"])

    // Second reconnect while first recovery is in-flight — queues
    // a pendingReconnect that runs after the first recovery completes.
    gate.onConnectionChange(false)
    gate.onConnectionChange(true)
    await Bun.sleep(STABILIZE_WAIT)
    // Still blocked on first recovery
    expect(calls).toEqual(["recover:1"])

    releaseFirst?.()
    await gate.waitForIdle()

    expect(calls).toEqual(["recover:1", "recover:2"])
  })

  test("cancels stabilization timer when connection drops before delay expires", async () => {
    let calls = 0
    const gate = createReconnectRecoveryGate({
      recover: async () => {
        calls++
      },
    })

    gate.onConnectionChange(true) // initial connect
    gate.onConnectionChange(false)
    gate.onConnectionChange(true) // reconnect — starts stabilization timer

    // Drop connection before stabilization completes
    await Bun.sleep(RECONNECT_STABILIZE_MS / 2)
    gate.onConnectionChange(false)

    // Wait past where the timer would have fired
    await Bun.sleep(STABILIZE_WAIT)
    await gate.waitForIdle()

    // Recovery should NOT have run — connection dropped during stabilization
    expect(calls).toBe(0)
  })

  test("surfaces synchronous recover throws through waitForIdle instead of throwing from the timer callback", async () => {
    let calls = 0
    const gate = createReconnectRecoveryGate({
      recover: () => {
        calls++
        throw new Error("sync recover failed")
      },
    })

    gate.onConnectionChange(true)
    gate.onConnectionChange(false)
    gate.onConnectionChange(true)

    await Bun.sleep(STABILIZE_WAIT)
    await expect(gate.waitForIdle()).rejects.toThrow("sync recover failed")
    expect(calls).toBe(1)

    gate.onConnectionChange(false)
    gate.onConnectionChange(true)
    await Bun.sleep(STABILIZE_WAIT)
    await expect(gate.waitForIdle()).rejects.toThrow("sync recover failed")
    expect(calls).toBe(2)
  })

  test("surfaces asynchronous recover rejections through waitForIdle", async () => {
    let calls = 0
    const gate = createReconnectRecoveryGate({
      recover: async () => {
        calls++
        throw new Error("async recover failed")
      },
    })

    gate.onConnectionChange(true)
    gate.onConnectionChange(false)
    gate.onConnectionChange(true)

    await Bun.sleep(STABILIZE_WAIT)
    await expect(gate.waitForIdle()).rejects.toThrow("async recover failed")
    expect(calls).toBe(1)
  })

  test("dispose cancels pending stabilization so a late reconnect recovery never fires after cleanup", async () => {
    let calls = 0
    const gate = createReconnectRecoveryGate({
      recover: async () => {
        calls++
      },
    })

    gate.onConnectionChange(true)
    gate.onConnectionChange(false)
    gate.onConnectionChange(true)

    await Bun.sleep(RECONNECT_STABILIZE_MS / 2)
    gate.dispose()

    await Bun.sleep(STABILIZE_WAIT)
    await gate.waitForIdle()

    expect(calls).toBe(0)
  })
})
