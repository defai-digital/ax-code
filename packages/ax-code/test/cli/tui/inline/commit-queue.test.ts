import { describe, expect, test } from "vitest"
import { createCommitQueue } from "../../../../src/cli/tui/inline/commit-queue"

describe("inline commit queue", () => {
  test("FIFO writes are serial even across async barriers", async () => {
    const events: string[] = []
    let release!: () => void
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const queue = createCommitQueue(async ({ key }) => {
      events.push(`start ${key}`)
      if (key === "a") await barrier
      events.push(`end ${key}`)
    })
    queue.enqueue({ key: "a" })
    queue.enqueue({ key: "b" })
    await Promise.resolve()
    expect(events).toEqual(["start a"])
    release()
    await queue.flush()
    expect(events).toEqual(["start a", "end a", "start b", "end b"])
  })

  test("coalesces adjacent progress but never across another block", async () => {
    const written: string[] = []
    const queue = createCommitQueue<{ key: string; progress?: boolean; text: string }>((block) => {
      written.push(block.text)
    })
    queue.enqueue({ key: "a", progress: true, text: "one" })
    queue.enqueue({ key: "a", progress: true, text: "two" })
    queue.enqueue({ key: "tool", text: "tool" })
    queue.enqueue({ key: "a", progress: true, text: "three" })
    queue.enqueue({ key: "a", text: "done" })
    await queue.close()
    expect(written).toEqual(["two", "tool", "three", "done"])
    expect(queue.enqueue({ key: "late", text: "late" })).toBe(false)
    expect(queue.size).toBe(0)
  })

  test("close drains pending writes and isolates failed writes and reporters", async () => {
    const written: string[] = []
    const queue = createCommitQueue(
      async ({ key }) => {
        if (key === "bad") throw new Error("write failed")
        written.push(key)
      },
      () => {
        throw new Error("reporter failed")
      },
    )
    queue.enqueue({ key: "a" })
    queue.enqueue({ key: "bad" })
    queue.enqueue({ key: "b" })
    await queue.close()
    await queue.close()
    expect(written).toEqual(["a", "b"])
  })
})
