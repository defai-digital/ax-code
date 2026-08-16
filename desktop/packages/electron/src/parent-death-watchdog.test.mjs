import { createRequire } from "node:module"
import { EventEmitter } from "node:events"
import { describe, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { startParentDeathWatchdog, DEFAULT_PARENT_CHECK_INTERVAL_MS } = require("./parent-death-watchdog.js")

describe("startParentDeathWatchdog", () => {
  test("fires once when the parentPort channel closes", () => {
    const parentPort = new EventEmitter()
    const onParentDeath = vi.fn()
    startParentDeathWatchdog({ parentPort, parentPid: null, onParentDeath })

    parentPort.emit("close")
    parentPort.emit("close")

    expect(onParentDeath).toHaveBeenCalledTimes(1)
  })

  test("fires when the parent PID check reports the parent gone", () => {
    let check
    const setTimer = vi.fn((callback) => {
      check = callback
      return { unref: vi.fn() }
    })
    const onParentDeath = vi.fn()
    startParentDeathWatchdog({
      parentPort: null,
      parentPid: 1234,
      onParentDeath,
      setTimer,
      isProcessAlive: () => false,
    })

    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), DEFAULT_PARENT_CHECK_INTERVAL_MS)
    check()
    expect(onParentDeath).toHaveBeenCalledTimes(1)
  })

  test("stays quiet while the parent is alive", () => {
    let check
    const setTimer = vi.fn((callback) => {
      check = callback
      return { unref: vi.fn() }
    })
    const onParentDeath = vi.fn()
    startParentDeathWatchdog({
      parentPort: null,
      parentPid: 1234,
      onParentDeath,
      setTimer,
      isProcessAlive: () => true,
    })

    check()
    check()
    expect(onParentDeath).not.toHaveBeenCalled()
  })

  test("stop() disarms both the channel listener and the PID check", () => {
    const parentPort = new EventEmitter()
    let check
    const setTimer = vi.fn((callback) => {
      check = callback
      return { unref: vi.fn() }
    })
    const clearTimer = vi.fn()
    const onParentDeath = vi.fn()
    const watchdog = startParentDeathWatchdog({
      parentPort,
      parentPid: 1234,
      onParentDeath,
      setTimer,
      clearTimer,
      isProcessAlive: () => false,
    })

    watchdog.stop()
    parentPort.emit("close")
    check()

    expect(onParentDeath).not.toHaveBeenCalled()
    expect(clearTimer).toHaveBeenCalledTimes(1)
  })

  test("does not poll when the parent PID is missing or init", () => {
    const setTimer = vi.fn(() => ({ unref: vi.fn() }))
    for (const parentPid of [undefined, null, 0, 1, Number.NaN]) {
      startParentDeathWatchdog({ parentPort: null, parentPid, onParentDeath: vi.fn(), setTimer })
    }
    expect(setTimer).not.toHaveBeenCalled()
  })
})
