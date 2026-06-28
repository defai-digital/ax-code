import { describe, expect, test } from "vitest"

import { CanvasSaveQueue, type CanvasSaveQueueStatus } from "./canvasAutosave"

type TestDocument = {
  id: string
  text: string
}

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

describe("CanvasSaveQueue", () => {
  test("serializes saves for a scope and coalesces queued stale drafts", async () => {
    const firstSave = createDeferred<void>()
    const firstDocument: TestDocument = { id: "main", text: "first" }
    const secondDocument: TestDocument = { id: "main", text: "second" }
    const thirdDocument: TestDocument = { id: "main", text: "third" }
    const latest = { current: firstDocument }
    const savedDocuments: TestDocument[] = []
    const statusEvents: CanvasSaveQueueStatus[] = []
    const saveCalls: Array<{ directory: string; document: TestDocument }> = []

    const queue = new CanvasSaveQueue<TestDocument>({
      save: async (directory, document) => {
        saveCalls.push({ directory, document })
        if (saveCalls.length === 1) {
          await firstSave.promise
        }
      },
      isCurrentScope: (scope) => scope === 1,
      isLatestDocument: (document) => document === latest.current,
      onLatestSaved: (_scope, document) => {
        savedDocuments.push(document)
      },
      onStatus: (_scope, status) => {
        statusEvents.push(status)
      },
    })

    const drain = queue.enqueue({ scope: 1, directory: "/workspace/project", document: firstDocument })
    latest.current = secondDocument
    queue.enqueue({ scope: 1, directory: "/workspace/project", document: secondDocument })
    latest.current = thirdDocument
    queue.enqueue({ scope: 1, directory: "/workspace/project", document: thirdDocument })

    expect(saveCalls.map((call) => call.document.text)).toEqual(["first"])
    expect(queue.hasPending(1)).toBe(true)

    firstSave.resolve()
    await drain

    expect(saveCalls.map((call) => call.document.text)).toEqual(["first", "third"])
    expect(saveCalls.map((call) => call.directory)).toEqual(["/workspace/project", "/workspace/project"])
    expect(savedDocuments).toEqual([thirdDocument])
    expect(statusEvents).toEqual(["saving", "saving", "saved"])
    expect(queue.hasPending(1)).toBe(false)
  })

  test("does not report stale scope completions as current UI state", async () => {
    const staleDocument: TestDocument = { id: "main", text: "stale" }
    const latestDocument: TestDocument = { id: "main", text: "latest" }
    const latest = { current: latestDocument }
    const savedDocuments: TestDocument[] = []
    const statusEvents: CanvasSaveQueueStatus[] = []

    const queue = new CanvasSaveQueue<TestDocument>({
      save: async () => {},
      isCurrentScope: (scope) => scope === 2,
      isLatestDocument: (document) => document === latest.current,
      onLatestSaved: (_scope, document) => {
        savedDocuments.push(document)
      },
      onStatus: (_scope, status) => {
        statusEvents.push(status)
      },
    })

    await queue.enqueue({ scope: 1, directory: "/old", document: staleDocument, notify: false })

    expect(savedDocuments).toEqual([])
    expect(statusEvents).toEqual([])
    expect(queue.hasPending(1)).toBe(false)
  })
})
