import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { scheduleTuiInterval, scheduleTuiTimeout } from "../../../src/cli/cmd/tui/util/timer"

describe("tui timers", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test("runs timeout callbacks through the TUI background failure boundary", async () => {
    const error = new Error("timeout failed")
    const logger = { warn: vi.fn() }

    scheduleTuiTimeout(
      () => {
        throw error
      },
      {
        name: "timeout-task",
        delayMs: 10,
        logger,
      },
    )

    await vi.advanceTimersByTimeAsync(10)

    expect(logger.warn).toHaveBeenCalledWith("tui background task failed", {
      taskName: "timeout-task",
      error,
    })
  })

  test("cancels pending timeout callbacks", async () => {
    const task = vi.fn()
    const cancel = scheduleTuiTimeout(task, {
      name: "cancelled-timeout",
      delayMs: 10,
    })

    cancel()
    await vi.advanceTimersByTimeAsync(10)

    expect(task).not.toHaveBeenCalled()
  })

  test("cancels interval callbacks", async () => {
    const task = vi.fn()
    const cancel = scheduleTuiInterval(task, {
      name: "interval-task",
      delayMs: 10,
    })

    await vi.advanceTimersByTimeAsync(25)
    expect(task).toHaveBeenCalledTimes(2)

    cancel()
    await vi.advanceTimersByTimeAsync(50)
    expect(task).toHaveBeenCalledTimes(2)
  })

  test("does not overlap interval callbacks by default", async () => {
    let release: (() => void) | undefined
    const task = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )

    scheduleTuiInterval(task, {
      name: "non-overlap-interval",
      delayMs: 10,
    })

    await vi.advanceTimersByTimeAsync(30)
    expect(task).toHaveBeenCalledTimes(1)

    release?.()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(10)

    expect(task).toHaveBeenCalledTimes(2)
  })
})
