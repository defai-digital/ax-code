import { afterEach, describe, expect, test, vi } from "vitest"
import { waitForOpenSocket, type ReadyStateSocket } from "./terminalSocketWait"

type TestSocket = ReadyStateSocket & {
  id: string
}

describe("waitForOpenSocket", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test("clears its wait timer when the socket opens before the timeout", async () => {
    vi.useFakeTimers()
    const socket: TestSocket = { id: "socket-1", readyState: 1 }

    await expect(waitForOpenSocket(Promise.resolve(socket), 1200)).resolves.toBe(socket)
    expect(vi.getTimerCount()).toBe(0)
  })

  test("resolves null and clears its timer when waiting times out", async () => {
    vi.useFakeTimers()
    const pending = waitForOpenSocket<TestSocket>(new Promise(() => {}), 25)
    const expectation = expect(pending).resolves.toBeNull()

    await vi.advanceTimersByTimeAsync(25)

    await expectation
    expect(vi.getTimerCount()).toBe(0)
  })

  test("resolves null when the open promise rejects before the timeout", async () => {
    vi.useFakeTimers()

    await expect(waitForOpenSocket<TestSocket>(Promise.reject(new Error("open failed")), 1200)).resolves.toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  test("ignores a late socket open after the wait timeout has already fired", async () => {
    vi.useFakeTimers()
    let resolveSocket: (socket: TestSocket) => void = () => {}
    const openPromise = new Promise<TestSocket>((resolve) => {
      resolveSocket = resolve
    })

    const pending = waitForOpenSocket(openPromise, 25)
    const expectation = expect(pending).resolves.toBeNull()
    await vi.advanceTimersByTimeAsync(25)
    resolveSocket({ id: "late", readyState: 1 })

    await expectation
    expect(vi.getTimerCount()).toBe(0)
  })

  test("does not return a socket that resolves before timeout but is not open", async () => {
    vi.useFakeTimers()
    const socket: TestSocket = { id: "connecting", readyState: 0 }

    await expect(waitForOpenSocket(Promise.resolve(socket), 1200)).resolves.toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})
