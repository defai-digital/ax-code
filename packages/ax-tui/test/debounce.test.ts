import { afterEach, expect, test, vi } from "vitest"
import { createDebounce, clearAllDebounces } from "../src/lib/debounce.js"

afterEach(() => {
  clearAllDebounces()
  vi.useRealTimers()
})

test("superseded and cleared operations settle with cancellation", async () => {
  vi.useFakeTimers()
  const controller = createDebounce("settlement")
  const cancelled = controller.debounce("work", 10, async () => 1).catch((error) => error.name)
  const latest = controller.debounce("work", 10, async () => 2)
  await vi.advanceTimersByTimeAsync(10)
  expect(await cancelled).toBe("AbortError")
  expect(await latest).toBe(2)
  const cleared = controller.debounce("work", 10, async () => 3).catch((error) => error.name)
  controller.clear()
  expect(await cleared).toBe("AbortError")
  expect(vi.getTimerCount()).toBe(0)
})

test("controllers remain usable after global cleanup and callbacks can debounce recursively", async () => {
  vi.useFakeTimers()
  const controller = createDebounce("reuse")
  clearAllDebounces()
  let inner: Promise<number> | undefined
  const outer = controller.debounce("work", 1, async () => {
    inner = controller.debounce("work", 1, async () => 42)
    return 1
  })
  await vi.advanceTimersByTimeAsync(1)
  expect(await outer).toBe(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(await inner).toBe(42)
})

test("callback rejection reaches the caller", async () => {
  vi.useFakeTimers()
  const result = createDebounce("errors")
    .debounce("work", 1, async () => {
      throw new Error("failed")
    })
    .catch((error) => error.message)
  await vi.advanceTimersByTimeAsync(1)
  expect(await result).toBe("failed")
})
