import { createRequire } from "node:module"
import { EventEmitter } from "node:events"
import { describe, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { createServerProcessLifecycle } = require("./server-process-lifecycle.js")

describe("server process lifecycle", () => {
  test("exits with failure after an unhandled rejection", async () => {
    const processTarget = new EventEmitter()
    const stop = vi.fn(async () => {})
    const exit = vi.fn()
    const logger = { error: vi.fn() }
    const lifecycle = createServerProcessLifecycle({
      processTarget,
      getServerHandle: () => ({ stop }),
      exit,
      logger,
    })
    lifecycle.installFatalHandlers()

    processTarget.emit("unhandledRejection", new Error("fatal"))
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))

    expect(stop).toHaveBeenCalledWith({ exitProcess: false })
    expect(logger.error).toHaveBeenCalledWith("[server-process] unhandled rejection:", expect.any(Error))
  })

  test("forces one failure exit when graceful cleanup hangs", async () => {
    let resolveStop
    const pendingStop = new Promise((resolve) => {
      resolveStop = resolve
    })
    let forceExit
    const timer = { unref: vi.fn() }
    const setTimer = vi.fn((callback) => {
      forceExit = callback
      return timer
    })
    const clearTimer = vi.fn()
    const exit = vi.fn()
    const lifecycle = createServerProcessLifecycle({
      processTarget: new EventEmitter(),
      getServerHandle: () => ({ stop: () => pendingStop }),
      exit,
      setTimer,
      clearTimer,
      logger: { error: vi.fn() },
      fatalShutdownTimeoutMs: 25,
    })

    const stopping = lifecycle.stop(1)
    await Promise.resolve()
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 25)
    forceExit()
    expect(exit).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(1)

    resolveStop()
    await stopping
    expect(clearTimer).toHaveBeenCalledWith(timer)
    expect(exit).toHaveBeenCalledTimes(1)
  })

  test("exits normally after a requested graceful stop without a force timer", async () => {
    const exit = vi.fn()
    const setTimer = vi.fn()
    const lifecycle = createServerProcessLifecycle({
      processTarget: new EventEmitter(),
      getServerHandle: () => ({ stop: vi.fn(async () => {}) }),
      exit,
      setTimer,
      logger: { error: vi.fn() },
    })

    await lifecycle.stop(0)

    expect(setTimer).not.toHaveBeenCalled()
    expect(exit).toHaveBeenCalledWith(0)
  })
})
