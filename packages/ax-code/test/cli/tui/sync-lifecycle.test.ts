import { describe, expect, test } from "bun:test"
import { registerSyncLifecycle } from "../../../src/cli/cmd/tui/context/sync-lifecycle"

describe("tui sync lifecycle", () => {
  test("registers root cleanup, starts on mount, and stops through mount cleanup", () => {
    const rootCleanups: Array<() => void> = []
    const mountCleanups: Array<() => void> = []
    const calls: string[] = []
    let mountCallback: (() => void) | undefined
    let inMount = false

    registerSyncLifecycle({
      onMount(callback) {
        mountCallback = callback
      },
      onCleanup(callback) {
        ;(inMount ? mountCleanups : rootCleanups).push(callback)
      },
      watchConnection: () => undefined,
      unsubscribeEvents() {
        calls.push("unsubscribe")
      },
      sseConnected: () => false,
      startupCoordinator: {
        start() {
          calls.push("start")
        },
        stop() {
          calls.push("stop")
        },
        onConnectionChange() {
          calls.push("connection")
        },
      },
    })

    expect(calls).toEqual([])
    expect(rootCleanups).toHaveLength(1)
    expect(mountCleanups).toHaveLength(0)

    rootCleanups[0]?.()
    expect(calls).toEqual(["stop", "unsubscribe"])

    inMount = true
    mountCallback?.()
    inMount = false

    expect(calls).toEqual(["stop", "unsubscribe", "start"])
    expect(mountCleanups).toHaveLength(1)

    mountCleanups[0]?.()
    expect(calls).toEqual(["stop", "unsubscribe", "start", "stop"])
  })

  test("stops startup coordination from root cleanup even when mount never runs", () => {
    const rootCleanups: Array<() => void> = []
    const calls: string[] = []

    registerSyncLifecycle({
      onMount: () => undefined,
      onCleanup(callback) {
        rootCleanups.push(callback)
      },
      watchConnection: () => undefined,
      unsubscribeEvents() {
        calls.push("unsubscribe")
      },
      sseConnected: () => false,
      startupCoordinator: {
        start() {
          calls.push("start")
        },
        stop() {
          calls.push("stop")
        },
        onConnectionChange() {
          calls.push("connection")
        },
      },
    })

    rootCleanups[0]?.()

    expect(calls).toEqual(["stop", "unsubscribe"])
  })

  test("watches connection state and forwards changes to the startup coordinator", () => {
    let watchSource: (() => boolean) | undefined
    let watchChange: ((connected: boolean) => void) | undefined
    const forwarded: boolean[] = []
    let connected = false

    registerSyncLifecycle({
      onMount: () => undefined,
      onCleanup: () => undefined,
      watchConnection(source, onChange) {
        watchSource = source
        watchChange = onChange
      },
      unsubscribeEvents: () => undefined,
      sseConnected: () => connected,
      startupCoordinator: {
        start: () => undefined,
        stop: () => undefined,
        onConnectionChange(value) {
          forwarded.push(value)
        },
      },
    })

    expect(watchSource?.()).toBe(false)
    connected = true
    expect(watchSource?.()).toBe(true)

    watchChange?.(true)
    watchChange?.(false)

    expect(forwarded).toEqual([true, false])
  })
})
