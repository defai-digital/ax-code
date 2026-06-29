import { describe, expect, test, vi } from "vitest"
import { PlanSaveQueue, type PlanSaveQueueEntry } from "./planAutosave"

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

describe("PlanSaveQueue", () => {
  test("serializes plan saves for the same path and coalesces queued drafts", async () => {
    const firstSave = createDeferred<void>()
    const first: PlanSaveQueueEntry = { path: "/repo/plan.md", content: "first" }
    const second: PlanSaveQueueEntry = { path: "/repo/plan.md", content: "second" }
    const third: PlanSaveQueueEntry = { path: "/repo/plan.md", content: "third" }
    const latest = { current: first }
    const saveCalls: PlanSaveQueueEntry[] = []
    const savedEntries: PlanSaveQueueEntry[] = []

    const queue = new PlanSaveQueue({
      save: async (path, content) => {
        saveCalls.push({ path, content })
        if (saveCalls.length === 1) {
          await firstSave.promise
        }
      },
      isLatestEntry: (entry) => entry === latest.current,
      onLatestSaved: (entry) => {
        savedEntries.push(entry)
      },
      onLatestError: vi.fn(),
    })

    const drain = queue.enqueue(first)
    latest.current = second
    queue.enqueue(second)
    latest.current = third
    queue.enqueue(third)

    expect(saveCalls.map((entry) => entry.content)).toEqual(["first"])
    expect(queue.hasPending("/repo/plan.md")).toBe(true)

    firstSave.resolve()
    await drain

    expect(saveCalls.map((entry) => entry.content)).toEqual(["first", "third"])
    expect(savedEntries).toEqual([third])
    expect(queue.hasPending("/repo/plan.md")).toBe(false)
  })

  test("suppresses stale write errors when a newer draft is queued", async () => {
    const first: PlanSaveQueueEntry = { path: "/repo/plan.md", content: "first" }
    const second: PlanSaveQueueEntry = { path: "/repo/plan.md", content: "second" }
    const latest = { current: second }
    const errors: unknown[] = []

    const queue = new PlanSaveQueue({
      save: async (_path, content) => {
        if (content === "first") {
          throw new Error("stale failure")
        }
      },
      isLatestEntry: (entry) => entry === latest.current,
      onLatestError: (_entry, error) => {
        errors.push(error)
      },
    })

    const drain = queue.enqueue(first)
    queue.enqueue(second)
    await drain

    expect(errors).toEqual([])
  })

  test("reports errors for the latest draft only", async () => {
    const latestEntry: PlanSaveQueueEntry = { path: "/repo/plan.md", content: "latest" }
    const errors: unknown[] = []

    const queue = new PlanSaveQueue({
      save: async () => {
        throw new Error("latest failure")
      },
      isLatestEntry: (entry) => entry === latestEntry,
      onLatestError: (_entry, error) => {
        errors.push(error)
      },
    })

    await queue.enqueue(latestEntry)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(Error)
  })
})
