import { expect, test, vi } from "vitest"
import { waitForSharedModelWork } from "../../src/provider/shared-model-work"

test("cancellation unsubscribes one waiter without failing shared initialization", async () => {
  const work = Promise.withResolvers<string>()
  const first = new AbortController()
  const second = new AbortController()
  const remove = vi.spyOn(first.signal, "removeEventListener")
  const cancelled = waitForSharedModelWork(work.promise, first.signal).catch((error) => error)
  const other = waitForSharedModelWork(work.promise, second.signal)
  first.abort(new Error("caller cancelled"))
  expect(await cancelled).toMatchObject({ message: "caller cancelled" })
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function))
  work.resolve("shared SDK")
  expect(await other).toBe("shared SDK")
})

test("an already cancelled subscriber still observes late initialization rejection", async () => {
  const controller = new AbortController()
  controller.abort()
  const work = Promise.withResolvers<string>()
  await expect(waitForSharedModelWork(work.promise, controller.signal)).rejects.toMatchObject({ name: "AbortError" })
  work.reject(new Error("late setup failure"))
  await new Promise<void>((resolve) => setImmediate(resolve))
})
