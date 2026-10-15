import { afterEach, expect, test, vi } from "vitest"
import { WorkQueue, WorkQueueFullError } from "../src/work-queue"

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

afterEach(() => vi.useRealTimers())

test("lifecycle owners drain admitted work before reporting cancellation", async () => {
  const queue = new WorkQueue(1, { drainOnAbort: true })
  const gate = deferred()
  const controller = new AbortController()
  let cleaned = false
  let settled = false
  const work = queue
    .run(async (signal) => {
      await gate.promise
      expect(signal.aborted).toBe(true)
      cleaned = true
    }, controller.signal)
    .finally(() => {
      settled = true
    })
  const rejected = expect(work).rejects.toThrow("dispose")
  controller.abort(new Error("dispose"))
  await new Promise((resolve) => setImmediate(resolve))
  expect(settled).toBe(false)
  gate.resolve()
  await rejected
  expect(cleaned).toBe(true)
})

test("overload rejects promptly and a cancelled waiter frees admission", async () => {
  const queue = new WorkQueue(1, { maxQueued: 1 })
  const gate = deferred()
  const running = queue.run(() => gate.promise)
  const controller = new AbortController()
  const called = vi.fn(async () => 2)
  const pending = queue.run(called, controller.signal)
  const rejected = expect(pending).rejects.toThrow("cancelled")
  await expect(queue.run(async () => 3)).rejects.toBeInstanceOf(WorkQueueFullError)
  controller.abort(new Error("cancelled"))
  await rejected
  const replacement = queue.run(async () => 4)
  gate.resolve()
  await running
  expect(await replacement).toBe(4)
  expect(called).not.toHaveBeenCalled()
})

test("running cancellation rejects late success without releasing the active slot early", async () => {
  const queue = new WorkQueue(1, { maxQueued: 0 })
  const gate = deferred()
  const controller = new AbortController()
  let received!: AbortSignal
  const running = queue.run(async (signal) => {
    received = signal
    await gate.promise
    return "late"
  }, controller.signal)
  const rejected = expect(running).rejects.toThrow("stop")
  controller.abort(new Error("stop"))
  await rejected
  expect(received.aborted).toBe(true)
  await expect(queue.run(async () => 2)).rejects.toBeInstanceOf(WorkQueueFullError)
  gate.resolve()
  await new Promise((resolve) => setImmediate(resolve))
  expect(await queue.run(async () => 3)).toBe(3)
})

test("one deadline covers admission and execution and retains timed-out active work", async () => {
  vi.useFakeTimers()
  const queue = new WorkQueue(1, { timeoutMs: 100, maxQueued: 1 })
  const firstGate = deferred()
  const secondGate = deferred()
  const first = queue.run(() => firstGate.promise)
  let secondSignal: AbortSignal | undefined
  const second = queue.run(async (signal) => {
    secondSignal = signal
    await secondGate.promise
  })
  const rejected = expect(second).rejects.toMatchObject({ name: "TimeoutError" })
  await vi.advanceTimersByTimeAsync(70)
  firstGate.resolve()
  await first
  await vi.advanceTimersByTimeAsync(30)
  await rejected
  expect(secondSignal?.aborted).toBe(true)
  const after = vi.fn(async () => 3)
  const pending = queue.run(after)
  expect(after).not.toHaveBeenCalled()
  secondGate.resolve()
  expect(await pending).toBe(3)
})

test("expired waiting work is never executed", async () => {
  vi.useFakeTimers()
  const queue = new WorkQueue(1, { timeoutMs: 50 })
  const gate = deferred()
  const first = queue.run(() => gate.promise)
  const failFirst = expect(first).rejects.toMatchObject({ name: "TimeoutError" })
  const callback = vi.fn(async () => 2)
  const second = queue.run(callback)
  const failSecond = expect(second).rejects.toMatchObject({ name: "TimeoutError" })
  await vi.advanceTimersByTimeAsync(50)
  await Promise.all([failFirst, failSecond])
  gate.resolve()
  await vi.advanceTimersByTimeAsync(0)
  expect(callback).not.toHaveBeenCalled()
  expect(await queue.run(async () => 3)).toBe(3)
})

test("keeps the deadline timer referenced so an awaited run cannot be silently dropped", async () => {
  // An unref'd deadline lets a short-lived process with no other pending work
  // exit 13 while a queued run's promise is still pending, instead of
  // rejecting with the TimeoutError the option exists to produce.
  const originalSetTimeout = globalThis.setTimeout
  let unrefCalls = 0
  globalThis.setTimeout = ((fn: (...args: any[]) => void, ms?: number, ...args: any[]) => {
    const timer = originalSetTimeout(fn, ms, ...args) as unknown as { unref?: () => unknown }
    if (timer && typeof timer === "object") {
      timer.unref = () => {
        unrefCalls += 1
        return timer
      }
    }
    return timer as unknown as ReturnType<typeof setTimeout>
  }) as typeof setTimeout

  try {
    const queue = new WorkQueue(1, { timeoutMs: 25, maxQueued: 1 })
    const gate = deferred()
    const first = queue.run(() => gate.promise)
    const failFirst = expect(first).rejects.toMatchObject({ name: "TimeoutError" })
    const second = queue.run(async () => 2)
    const failSecond = expect(second).rejects.toMatchObject({ name: "TimeoutError" })
    await Promise.all([failFirst, failSecond])
    gate.resolve()
    expect(unrefCalls).toBe(0)
  } finally {
    globalThis.setTimeout = originalSetTimeout
  }
})

test.each([false, true])("rejects a completion after a blocked deadline (drain=%s)", async (drainOnAbort) => {
  const queue = new WorkQueue(1, { timeoutMs: 5, drainOnAbort })
  let received!: AbortSignal
  const pending = queue.run(async (signal) => {
    received = signal
    const until = performance.now() + 20
    while (performance.now() < until) {}
    return "late"
  })
  await expect(pending).rejects.toMatchObject({ name: "TimeoutError" })
  expect(received.aborted).toBe(true)
  expect(await queue.run(async () => "next")).toBe("next")
})

test("does not start queued work whose deadline elapsed before timers could run", async () => {
  const queue = new WorkQueue(1, { timeoutMs: 5 })
  const gate = deferred()
  const first = queue
    .run(() => gate.promise)
    .then(
      () => "success",
      (error: Error) => error.name,
    )
  const callback = vi.fn(async () => "queued")
  const second = queue.run(callback).then(
    () => "success",
    (error: Error) => error.name,
  )
  gate.resolve()
  const until = performance.now() + 20
  while (performance.now() < until) {}
  expect(await Promise.all([first, second])).toEqual(["TimeoutError", "TimeoutError"])
  expect(callback).not.toHaveBeenCalled()
})

test("large deadlines do not overflow into an immediate timeout", async () => {
  vi.useFakeTimers()
  const queue = new WorkQueue(1, { timeoutMs: 2_147_483_647 + 1000 })
  const gate = deferred()
  let state = "pending"
  const running = queue
    .run(() => gate.promise)
    .then(
      () => {
        state = "completed"
      },
      () => {
        state = "timed out"
      },
    )
  await vi.advanceTimersByTimeAsync(2_147_483_647)
  expect(state).toBe("pending")
  gate.resolve()
  await running
  expect(state).toBe("completed")
})

test("classifies a blocked rejection as a deadline failure", async () => {
  const queue = new WorkQueue(1, { timeoutMs: 5 })
  await expect(
    queue.run(async () => {
      const until = performance.now() + 20
      while (performance.now() < until) {}
      throw new Error("late failure")
    }),
  ).rejects.toMatchObject({ name: "TimeoutError" })
})

test("draining preserves cleanup errors after an explicit parent abort", async () => {
  const queue = new WorkQueue(1, { drainOnAbort: true })
  const gate = deferred()
  const controller = new AbortController()
  const pending = queue.run(async () => {
    await gate.promise
    throw new Error("cleanup failed")
  }, controller.signal)
  controller.abort(new Error("user cancelled"))
  gate.resolve()
  await expect(pending).rejects.toThrow("cleanup failed")
})
