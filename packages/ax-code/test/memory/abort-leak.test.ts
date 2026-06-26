import { afterEach, describe, expect, test, vi } from "vitest"
import { abortAfter, abortAfterAny } from "../../src/util/abort"

type TimeoutHandler = Parameters<typeof setTimeout>[0]
type TimeoutID = ReturnType<typeof setTimeout>

function captureTimeout() {
  let handler: TimeoutHandler | undefined
  const timeoutID = { id: "timer" } as unknown as TimeoutID
  const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((nextHandler: TimeoutHandler) => {
    handler = nextHandler
    return timeoutID
  }) as typeof setTimeout)
  const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout").mockImplementation(() => undefined)

  return {
    timeoutID,
    setTimeoutSpy,
    clearTimeoutSpy,
    getHandler: () => handler,
  }
}

describe("memory: abort timeout callbacks", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test("abortAfter schedules a bound abort callback without closure capture", () => {
    const timer = captureTimeout()
    const timeout = abortAfter(1000)

    expect(timer.setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1000)
    const handler = timer.getHandler()
    expect(typeof handler).toBe("function")
    const handlerFn = handler as (() => void) & { name: string }
    expect(handlerFn.name).toBe("bound abort")

    handlerFn()
    expect(timeout.signal.aborted).toBe(true)
  })

  test("abortAfter clearTimeout cancels the scheduled timer", () => {
    const timer = captureTimeout()
    const timeout = abortAfter(1000)

    timeout.clearTimeout()

    expect(timer.clearTimeoutSpy).toHaveBeenCalledWith(timer.timeoutID)
  })

  test("abortAfterAny aborts when an input signal aborts", () => {
    const timer = captureTimeout()
    const parent = new AbortController()
    const timeout = abortAfterAny(1000, parent.signal)

    parent.abort()

    expect(timeout.signal.aborted).toBe(true)
    timeout.clearTimeout()
    expect(timer.clearTimeoutSpy).toHaveBeenCalledWith(timer.timeoutID)
  })
})
