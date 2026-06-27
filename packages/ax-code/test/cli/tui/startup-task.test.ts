import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { scheduleDeferredStartupTask } from "../../../src/cli/cmd/tui/util/startup-task"

describe("tui deferred startup tasks", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test("logs synchronous task failures without throwing from the timer callback", async () => {
    const error = new Error("sync task failed")
    const logger = { warn: vi.fn() }

    scheduleDeferredStartupTask(
      () => {
        throw error
      },
      { name: "sync-task", logger },
    )

    await vi.runAllTimersAsync()

    expect(logger.warn).toHaveBeenCalledWith("deferred startup task failed", { taskName: "sync-task", error })
  })

  test("logs asynchronous task rejections without leaking unhandled rejections", async () => {
    const error = new Error("async task failed")
    const logger = { warn: vi.fn() }

    scheduleDeferredStartupTask(() => Promise.reject(error), { name: "async-task", logger })

    await vi.runAllTimersAsync()

    expect(logger.warn).toHaveBeenCalledWith("deferred startup task failed", { taskName: "async-task", error })
  })

  test("routes failures to caller handlers when provided", async () => {
    const error = new Error("handled task failed")
    const logger = { warn: vi.fn() }
    const onError = vi.fn()

    scheduleDeferredStartupTask(() => Promise.reject(error), {
      name: "handled-task",
      logger,
      onError,
    })

    await vi.runAllTimersAsync()

    expect(onError).toHaveBeenCalledWith(error)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  test("keeps handler failures inside the deferred task boundary", async () => {
    const originalError = new Error("task failed")
    const handlerError = new Error("handler failed")
    const logger = { warn: vi.fn() }

    scheduleDeferredStartupTask(() => Promise.reject(originalError), {
      name: "handler-task",
      logger,
      onError() {
        throw handlerError
      },
    })

    await vi.runAllTimersAsync()

    expect(logger.warn).toHaveBeenCalledWith("deferred startup task error handler failed", {
      taskName: "handler-task",
      error: handlerError,
      originalError,
    })
  })

  test("does not log after cancellation", async () => {
    const logger = { warn: vi.fn() }
    const cancel = scheduleDeferredStartupTask(() => Promise.reject(new Error("cancelled")), {
      name: "cancelled-task",
      logger,
    })

    cancel()
    await vi.runAllTimersAsync()

    expect(logger.warn).not.toHaveBeenCalled()
  })
})
