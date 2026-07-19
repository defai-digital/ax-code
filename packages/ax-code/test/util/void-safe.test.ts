import { describe, expect, test, vi } from "vitest"
import { voidSafe } from "../../src/util/void-safe"

describe("voidSafe", () => {
  test("swallows async rejections without becoming unhandled", async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason)
    }
    process.on("unhandledRejection", onUnhandled)
    try {
      voidSafe(async () => {
        throw new Error("async fail")
      }, "test-async")
      await new Promise((r) => setTimeout(r, 20))
      expect(unhandled).toEqual([])
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }
  })

  test("swallows synchronous throws from the task factory", () => {
    expect(() =>
      voidSafe(() => {
        throw new Error("sync fail")
      }, "test-sync"),
    ).not.toThrow()
  })

  test("runs successful tasks", async () => {
    const spy = vi.fn(async () => 42)
    voidSafe(spy, "ok")
    await new Promise((r) => setTimeout(r, 10))
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
