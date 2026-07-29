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

  test("concurrent forceImmediate calls serialize writeOne in call order", async () => {
    const writes: string[] = []
    const started: string[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let inFlight = 0
    let maxInFlight = 0

    const batcher = createPartWriteBatcher<{ id: string; text: string }>({
      write: async (part) => {
        started.push(part.text)
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        if (part.text === "a") await firstGate
        writes.push(part.text)
        inFlight--
      },
      schedule: () => ({ clear: () => undefined }),
    })

    const first = batcher.forceImmediate({ id: "p1", text: "a" })
    // Let the first write start and park on firstGate before enqueueing the second.
    await vi.waitFor(() => {
      expect(started).toEqual(["a"])
    })
    const second = batcher.forceImmediate({ id: "p2", text: "b" })

    // Second must not start writeOne until the first completes.
    await Promise.resolve()
    expect(started).toEqual(["a"])
    expect(writes).toEqual([])

    releaseFirst()
    await Promise.all([first, second])

    expect(writes).toEqual(["a", "b"])
    expect(started).toEqual(["a", "b"])
    expect(maxInFlight).toBe(1)
  })

  test("forceImmediate stays ordered ahead of a concurrent flush of other parts", async () => {
    const writes: string[] = []
    let releaseForce!: () => void
    const forceGate = new Promise<void>((resolve) => {
      releaseForce = resolve
    })
    let scheduled: (() => void) | undefined

    const batcher = createPartWriteBatcher<{ id: string; text: string }>({
      write: async (part) => {
        if (part.text === "force") await forceGate
        writes.push(part.text)
      },
      schedule: (fn) => {
        scheduled = fn
        return { clear: () => undefined }
      },
    })

    const force = batcher.forceImmediate({ id: "p1", text: "force" })
    await vi.waitFor(() => {
      expect(writes).toEqual([])
    })
    // Force is in-flight; a window flush of another part must wait on the chain.
    batcher.schedule({ id: "p2", text: "snap" })
    scheduled!()
    const flush = batcher.flush()

    await Promise.resolve()
    expect(writes).toEqual([])

    releaseForce()
    await Promise.all([force, flush])
    expect(writes).toEqual(["force", "snap"])
  })
})
