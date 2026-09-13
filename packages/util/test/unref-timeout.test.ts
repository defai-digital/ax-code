import { describe, expect, test, vi } from "vitest"
import { sleep, withTimeout } from "../src/unref-timeout"

describe("sleep", () => {
  test("resolves after the requested delay", async () => {
    const start = performance.now()
    await sleep(15)
    expect(performance.now() - start).toBeGreaterThanOrEqual(10)
  })

  test("unrefs its timer so it cannot hold the process open", async () => {
    const unref = vi.fn()
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      cb: (...args: unknown[]) => void,
    ) => {
      cb()
      return { unref } as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof setTimeout)
    try {
      await sleep(60_000)
    } finally {
      spy.mockRestore()
    }
    expect(unref).toHaveBeenCalledTimes(1)
  })
})

describe("withTimeout", () => {
  test("resolves with the value when the promise settles first", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1000)).resolves.toBe("ok")
  })

  test("rejects with a custom message when the timeout fires first", async () => {
    await expect(withTimeout(sleep(1000).then(() => "late"), 5, "too slow")).rejects.toThrow("too slow")
  })

  test("rejects with a default message that includes the timeout", async () => {
    await expect(withTimeout(sleep(1000), 5)).rejects.toThrow(/timed out after 5ms/)
  })

  test("propagates the original rejection when it settles first", async () => {
    await expect(withTimeout(Promise.reject(new Error("boom")), 1000)).rejects.toThrow("boom")
  })

  test("unrefs the timeout timer", async () => {
    const unref = vi.fn()
    const setSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation((() => {
      return { unref } as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof setTimeout)
    const clearSpy = vi.spyOn(globalThis, "clearTimeout").mockImplementation((() => {}) as unknown as typeof clearTimeout)
    try {
      await expect(withTimeout(Promise.resolve(1), 60_000)).resolves.toBe(1)
    } finally {
      setSpy.mockRestore()
      clearSpy.mockRestore()
    }
    expect(unref).toHaveBeenCalledTimes(1)
  })

  test("swallows a rejection that arrives after the timeout", async () => {
    let rejectLate: (err: Error) => void = () => {}
    const late = new Promise<never>((_, reject) => {
      rejectLate = reject
    })
    await expect(withTimeout(late, 5)).rejects.toThrow(/timed out/)
    // If the manual race did not attach a rejection handler, this would
    // surface as an unhandled rejection and fail the test run.
    rejectLate(new Error("late rejection"))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})
