import { afterEach, describe, expect, test, vi } from "vitest"
import { withTimeout } from "./asyncTimeout"

describe("withTimeout", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test("clears its timer when the operation resolves before timeout", async () => {
    vi.useFakeTimers()

    await expect(withTimeout(Promise.resolve("ok"), 1000, () => "timeout")).resolves.toBe("ok")
    expect(vi.getTimerCount()).toBe(0)
  })

  test("clears its timer when the operation rejects before timeout", async () => {
    vi.useFakeTimers()

    await expect(withTimeout(Promise.reject(new Error("failed")), 1000, () => "timeout")).rejects.toThrow("failed")
    expect(vi.getTimerCount()).toBe(0)
  })

  test("uses the timeout fallback when the operation does not settle in time", async () => {
    vi.useFakeTimers()
    const pending = withTimeout(new Promise<string>(() => {}), 25, () => "timeout")
    const expectation = expect(pending).resolves.toBe("timeout")

    await vi.advanceTimersByTimeAsync(25)

    await expectation
    expect(vi.getTimerCount()).toBe(0)
  })

  test("rejects with the timeout error when the timeout fallback throws", async () => {
    vi.useFakeTimers()
    const pending = withTimeout(new Promise<string>(() => {}), 25, () => {
      throw new Error("timed out")
    })
    const expectation = expect(pending).rejects.toThrow("timed out")

    await vi.advanceTimersByTimeAsync(25)

    await expectation
    expect(vi.getTimerCount()).toBe(0)
  })

  test("ignores a late operation result after the timeout has already settled", async () => {
    vi.useFakeTimers()
    let resolveOperation: (value: string) => void = () => {}
    const operation = new Promise<string>((resolve) => {
      resolveOperation = resolve
    })
    const pending = withTimeout(operation, 25, () => "timeout")
    const expectation = expect(pending).resolves.toBe("timeout")

    await vi.advanceTimersByTimeAsync(25)
    resolveOperation("late")

    await expectation
    expect(vi.getTimerCount()).toBe(0)
  })
})
