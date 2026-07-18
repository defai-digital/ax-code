import { afterEach, describe, expect, test, vi } from "vitest"

import { startSingleFlightInterval } from "./singleFlightInterval"

describe("startSingleFlightInterval", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test("does not overlap slow polls and resumes after the active poll settles", async () => {
    vi.useFakeTimers()
    let resolveActive: (() => void) | undefined
    let running = 0
    let maxRunning = 0
    const task = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          running += 1
          maxRunning = Math.max(maxRunning, running)
          resolveActive = () => {
            running -= 1
            resolve()
          }
        }),
    )

    const stop = startSingleFlightInterval(task, 2_000)

    await vi.advanceTimersByTimeAsync(6_000)
    expect(task).toHaveBeenCalledTimes(1)
    expect(maxRunning).toBe(1)

    resolveActive?.()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(task).toHaveBeenCalledTimes(2)
    expect(maxRunning).toBe(1)

    stop()
  })

  test("marks an active poll cancelled and prevents later polls after cleanup", async () => {
    vi.useFakeTimers()
    let cancelled: (() => boolean) | undefined
    let resolveActive: (() => void) | undefined
    const task = vi.fn(
      (isCancelled: () => boolean) =>
        new Promise<void>((resolve) => {
          cancelled = isCancelled
          resolveActive = resolve
        }),
    )

    const stop = startSingleFlightInterval(task, 2_000, { immediate: true })
    await Promise.resolve()
    expect(cancelled?.()).toBe(false)

    stop()
    expect(cancelled?.()).toBe(true)
    resolveActive?.()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(task).toHaveBeenCalledTimes(1)
  })

  test("reports a failed poll and allows the next interval to retry", async () => {
    vi.useFakeTimers()
    const error = new Error("offline")
    const onError = vi.fn()
    const task = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined)

    const stop = startSingleFlightInterval(task, 2_000, { onError })
    await vi.advanceTimersByTimeAsync(4_000)

    expect(onError).toHaveBeenCalledWith(error)
    expect(task).toHaveBeenCalledTimes(2)
    stop()
  })
})
