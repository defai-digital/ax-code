import { describe, expect, test } from "bun:test"
import { McpAuth } from "../../src/mcp/auth"

describe("McpAuth.withLock", () => {
  test("releases idle key entries after queued work drains", async () => {
    const lock = McpAuth.createLockMapForTest()
    const order: string[] = []
    let releaseFirst!: () => void

    const first = lock.run("mcp-auth.json", async () => {
      order.push("first:start")
      await new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      order.push("first:end")
    })

    const second = lock.run("mcp-auth.json", async () => {
      order.push("second")
    })

    await Promise.resolve()
    expect(order).toEqual(["first:start"])
    expect(lock.size()).toBe(1)

    releaseFirst()
    await Promise.all([first, second])

    expect(order).toEqual(["first:start", "first:end", "second"])
    expect(lock.size()).toBe(0)
  })

  test("continues queued work and cleans up after a failure", async () => {
    const lock = McpAuth.createLockMapForTest()
    const order: string[] = []
    let releaseFirst!: () => void

    const first = lock.run("mcp-auth.json", async () => {
      order.push("first")
      await new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      throw new Error("boom")
    })

    const second = lock.run("mcp-auth.json", async () => {
      order.push("second")
      return "ok"
    })

    await Promise.resolve()
    expect(order).toEqual(["first"])
    expect(lock.size()).toBe(1)

    releaseFirst()

    await expect(first).rejects.toThrow("boom")
    await expect(second).resolves.toBe("ok")
    expect(order).toEqual(["first", "second"])
    expect(lock.size()).toBe(0)
  })
})
