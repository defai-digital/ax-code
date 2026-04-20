import { describe, expect, test } from "bun:test"
import { createReconnectRecoveryGate } from "../../../src/cli/cmd/tui/util/reconnect-recovery"

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
    await gate.waitForIdle()

    expect(calls).toBe(1)
  })

  test("deduplicates overlapping reconnect recoveries while one is already running", async () => {
    let calls = 0
    let release: (() => void) | undefined
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const gate = createReconnectRecoveryGate({
      recover: async () => {
        calls++
        await pending
      },
    })

    gate.onConnectionChange(true)
    gate.onConnectionChange(false)
    gate.onConnectionChange(true)
    gate.onConnectionChange(false)
    gate.onConnectionChange(true)

    await Bun.sleep(0)
    expect(calls).toBe(1)

    release?.()
    await gate.waitForIdle()

    expect(calls).toBe(2)

    gate.onConnectionChange(false)
    gate.onConnectionChange(true)
    await gate.waitForIdle()

    expect(calls).toBe(3)
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

    gate.onConnectionChange(true)
    gate.onConnectionChange(false)
    gate.onConnectionChange(true)
    await Bun.sleep(0)
    expect(calls).toEqual(["recover:1"])

    gate.onConnectionChange(false)
    gate.onConnectionChange(true)
    await Bun.sleep(0)
    expect(calls).toEqual(["recover:1"])

    releaseFirst?.()
    await gate.waitForIdle()

    expect(calls).toEqual(["recover:1", "recover:2"])
  })
})
