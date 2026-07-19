import { describe, expect, test, vi } from "vitest"
import { createPartWriteBatcher } from "../../src/session/part-write-batcher"

describe("createPartWriteBatcher", () => {
  test("coalesces multiple schedule calls for the same part to the latest snapshot", async () => {
    const writes: Array<{ id: string; text: string }> = []
    let scheduled: (() => void) | undefined
    const batcher = createPartWriteBatcher<{ id: string; text: string }>({
      write: async (part) => {
        writes.push({ ...part })
      },
      schedule: (fn) => {
        scheduled = fn
        return { clear: () => undefined }
      },
    })

    batcher.schedule({ id: "p1", text: "a" })
    batcher.schedule({ id: "p1", text: "ab" })
    batcher.schedule({ id: "p1", text: "abc" })
    expect(batcher.pendingCount()).toBe(1)
    expect(writes).toEqual([])
    scheduled!()
    await batcher.flush()
    expect(writes).toEqual([{ id: "p1", text: "abc" }])
    expect(batcher.pendingCount()).toBe(0)
  })

  test("forceImmediate bypasses the queue and writes immediately", async () => {
    const writes: string[] = []
    const batcher = createPartWriteBatcher<{ id: string; text: string }>({
      write: async (part) => {
        writes.push(part.text)
      },
      schedule: () => ({ clear: () => undefined }),
    })
    batcher.schedule({ id: "p1", text: "stale" })
    await batcher.forceImmediate({ id: "p1", text: "final" })
    expect(writes).toEqual(["final"])
    expect(batcher.pendingCount()).toBe(0)
  })

  test("flush drains every pending part", async () => {
    const writes: string[] = []
    const batcher = createPartWriteBatcher<{ id: string; text: string }>({
      write: async (part) => {
        writes.push(`${part.id}:${part.text}`)
      },
      schedule: () => ({ clear: () => undefined }),
    })
    batcher.schedule({ id: "a", text: "1" })
    batcher.schedule({ id: "b", text: "2" })
    await batcher.flush()
    expect(writes.sort()).toEqual(["a:1", "b:2"])
  })

  test("onError is invoked when a write rejects", async () => {
    const onError = vi.fn()
    const batcher = createPartWriteBatcher<{ id: string; text: string }>({
      write: async () => {
        throw new Error("db down")
      },
      onError,
      schedule: () => ({ clear: () => undefined }),
    })
    await expect(batcher.forceImmediate({ id: "p1", text: "x" })).rejects.toThrow("db down")
    expect(onError).toHaveBeenCalledWith(expect.any(Error), "p1")
  })
})
