import { describe, expect, test, vi } from "vitest"
import { setTimeout as sleep } from "node:timers/promises"
import { runTuiBackgroundTask } from "../../../src/cli/cmd/tui/util/background-task"

describe("tui background tasks", () => {
  test("logs synchronous task failures without leaking unhandled rejections", async () => {
    const error = new Error("sync task failed")
    const logger = { warn: vi.fn() }

    runTuiBackgroundTask(
      () => {
        throw error
      },
      { name: "sync-task", logger },
    )
    await Promise.resolve()
    await Promise.resolve()

    expect(logger.warn).toHaveBeenCalledWith("tui background task failed", { taskName: "sync-task", error })
  })

  test("logs asynchronous task rejections", async () => {
    const error = new Error("async task failed")
    const logger = { warn: vi.fn() }

    runTuiBackgroundTask(() => Promise.reject(error), { name: "async-task", logger })
    await sleep(0)

    expect(logger.warn).toHaveBeenCalledWith("tui background task failed", { taskName: "async-task", error })
  })

  test("routes failures to caller handlers when provided", async () => {
    const error = new Error("handled task failed")
    const logger = { warn: vi.fn() }
    const onError = vi.fn()

    runTuiBackgroundTask(() => Promise.reject(error), {
      name: "handled-task",
      logger,
      onError,
    })
    await sleep(0)

    expect(onError).toHaveBeenCalledWith(error)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  test("keeps handler failures inside the background task boundary", async () => {
    const originalError = new Error("task failed")
    const handlerError = new Error("handler failed")
    const logger = { warn: vi.fn() }

    runTuiBackgroundTask(() => Promise.reject(originalError), {
      name: "handler-task",
      logger,
      onError() {
        throw handlerError
      },
    })
    await sleep(0)

    expect(logger.warn).toHaveBeenCalledWith("tui background task error handler failed", {
      taskName: "handler-task",
      error: handlerError,
      originalError,
    })
  })

  test("does not report failures after cancellation", async () => {
    const logger = { warn: vi.fn() }
    const cancel = runTuiBackgroundTask(() => Promise.reject(new Error("cancelled")), {
      name: "cancelled-task",
      logger,
    })

    cancel()
    await sleep(0)

    expect(logger.warn).not.toHaveBeenCalled()
  })
})
