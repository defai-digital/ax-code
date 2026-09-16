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
