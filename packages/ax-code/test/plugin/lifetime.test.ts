import { afterEach, describe, expect, test, vi } from "vitest"
import { EventEmitter, getEventListeners } from "node:events"
import { PluginLifetime } from "../../src/plugin/lifetime"

afterEach(() => vi.useRealTimers())

describe("plugin owned lifetime", () => {
  test("repeated lifetimes release timers and subscriptions without accumulating resources", async () => {
    vi.useFakeTimers()
    const root = new AbortController()
    const emitter = new EventEmitter()
    const receive = vi.fn()
    const tick = vi.fn()
    for (let index = 0; index < 20; index++) {
      const owner = PluginLifetime.create(root.signal, vi.fn())
      emitter.on("change", receive)
      const timer = setInterval(tick, 100)
      owner.onDispose(() => {
        emitter.off("change", receive)
      })
      owner.onDispose(() => clearInterval(timer))
      emitter.emit("change")
      await vi.advanceTimersByTimeAsync(100)
      await owner.dispose()
      await owner.dispose()
      expect(emitter.listenerCount("change")).toBe(0)
      expect(getEventListeners(root.signal, "abort")).toHaveLength(0)
      expect(vi.getTimerCount()).toBe(0)
    }
    expect(receive).toHaveBeenCalledTimes(20)
    expect(tick).toHaveBeenCalledTimes(20)
  })

  test("times out a stalled callback, aborts it, and observes a late rejection", async () => {
    vi.useFakeTimers()
    const root = new AbortController()
    const owner = PluginLifetime.create(root.signal, vi.fn())
    let rejectLate!: (error: Error) => void
    let invocation!: AbortSignal
    const result = owner
      .run(({ signal }) => {
        invocation = signal
        return new Promise((_, reject) => {
          rejectLate = reject
        })
      })
      .catch((error) => error)
    await vi.advanceTimersByTimeAsync(PluginLifetime.CALLBACK_TIMEOUT_MS)
    expect(await result).toMatchObject({ data: { reason: "timeout" } })
    expect(invocation.aborted).toBe(true)
    expect(owner.signal.aborted).toBe(true)
    rejectLate(new Error("late callback failure"))
    await Promise.resolve()
    await expect(owner.run(() => "never")).rejects.toMatchObject({ data: { reason: "disposed" } })
    expect(getEventListeners(root.signal, "abort")).toHaveLength(0)
  })

  test("runs all cleanups once in reverse start order despite hangs and errors", async () => {
    vi.useFakeTimers()
    const failed = vi.fn()
    const owner = PluginLifetime.create(new AbortController().signal, failed)
    const order: string[] = []
    owner.onDispose(() => {
      order.push("first")
    })
    owner.onDispose(() => {
      order.push("throw")
      throw new Error("private callback details")
    })
    owner.onDispose(() => {
      order.push("hang")
      return new Promise(() => {})
    })
    owner.onDispose(() => {
      order.push("last")
    })
    const unregister = owner.onDispose(() => {
      order.push("removed")
    })
    unregister()
    const disposal = owner.dispose()
    await vi.advanceTimersByTimeAsync(PluginLifetime.CLEANUP_TIMEOUT_MS)
    await disposal
    await owner.dispose()
    expect(order).toEqual(["last", "hang", "throw", "first"])
    expect(failed).toHaveBeenCalledTimes(2)
    owner.onDispose(() => {
      order.push("late")
    })
    await Promise.resolve()
    expect(order.at(-1)).toBe("late")
  })

  test("removes invocation listeners and timers on success and ordinary failure", async () => {
    const root = new AbortController()
    const owner = PluginLifetime.create(root.signal, vi.fn())
    for (let index = 0; index < 20; index++) {
      await expect(owner.run(() => index)).resolves.toBe(index)
      await expect(
        owner.run(() => {
          throw new Error("test failure")
        }),
      ).rejects.toThrow("test failure")
    }
    expect(getEventListeners(owner.signal, "abort")).toHaveLength(0)
    expect(owner.signal.aborted).toBe(false)
    await owner.dispose()
    expect(getEventListeners(root.signal, "abort")).toHaveLength(0)
  })

  test("parent cancellation stops all pending callbacks and executes registered cleanup", async () => {
    const root = new AbortController()
    const cleaned = vi.fn()
    const owner = PluginLifetime.create(root.signal, vi.fn())
    owner.onDispose(cleaned)
    const results = [owner.run(() => new Promise(() => {})), owner.run(() => new Promise(() => {}))].map((pending) =>
      pending.catch((error) => error),
    )
    root.abort()
    for (const result of await Promise.all(results)) expect(result).toMatchObject({ data: { reason: "disposed" } })
    await owner.dispose()
    expect(cleaned).toHaveBeenCalledOnce()
  })
})
