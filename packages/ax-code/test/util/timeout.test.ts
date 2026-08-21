import { describe, expect, test } from "vitest"
import { sleep, withTimeout } from "../../src/util/timeout"

describe("util.timeout", () => {
  test("should resolve when promise completes before timeout", async () => {
    const fastPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve("fast"), 10)
    })

    const result = await withTimeout(fastPromise, 100)
    expect(result).toBe("fast")
  })

  test("should reject when promise exceeds timeout", async () => {
    const slowPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve("slow"), 200)
    })

    await expect(withTimeout(slowPromise, 50)).rejects.toThrow("Operation timed out after 50ms")
  })

  test("should not surface late rejection after timeout as unhandled", async () => {
    let rejectLate!: (err: Error) => void
    const late = new Promise<string>((_resolve, reject) => {
      rejectLate = reject
    })
    await expect(withTimeout(late, 20)).rejects.toThrow(/timed out/)
    // If the implementation mishandles this, Node would emit unhandledRejection.
    rejectLate(new Error("late failure"))
    await new Promise((r) => setTimeout(r, 30))
  })
})

describe("util.timeout.sleep", () => {
  // Regression: sleep() used to unref its timer unconditionally. Any awaited
  // sleep that was the only pending work let Node drain the event loop and
  // exit, leaving the awaiting promise unsettled — in a CLI process that is an
  // immediate exit 13 (ERR_UNSETTLED_TOP_LEVEL_AWAIT) with no output. It broke
  // `ax-code risk` whenever FileLock.acquire had to poll for a contended key.
  function captureTimerRef(fn: () => void) {
    const original = globalThis.setTimeout
    let hadRef: boolean | undefined
    globalThis.setTimeout = ((handler: TimerHandler, ms?: number, ...rest: unknown[]) => {
      const timer = original(handler as never, ms, ...(rest as never[]))
      const target = timer as unknown as { hasRef?: () => boolean }
      queueMicrotask(() => {
        if (hadRef === undefined) hadRef = target.hasRef?.() ?? true
      })
      return timer
    }) as unknown as typeof globalThis.setTimeout
    try {
      fn()
    } finally {
      globalThis.setTimeout = original
    }
    return () => hadRef
  }

  test("keeps the timer ref'd by default so an awaited sleep holds the loop open", async () => {
    const read = captureTimerRef(() => void sleep(1))
    await sleep(5)
    expect(read()).toBe(true)
  })

  test("unrefs only when explicitly requested", async () => {
    const read = captureTimerRef(() => void sleep(1, { unref: true }))
    await sleep(5)
    expect(read()).toBe(false)
  })

  test("still resolves after the delay", async () => {
    const start = Date.now()
    await sleep(20)
    expect(Date.now() - start).toBeGreaterThanOrEqual(15)
  })
})
