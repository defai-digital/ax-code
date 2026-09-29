import { describe, expect, test } from "vitest"
import { mapWithBoundedConcurrency } from "../src/discovery-concurrency.js"

describe("mapWithBoundedConcurrency", () => {
  test("preserves input order and bounds in-flight work", async () => {
    let active = 0
    let peak = 0
    const result = await mapWithBoundedConcurrency([1, 2, 3, 4, 5, 6], 2, async (value) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active--
      return value * 10
    })
    expect(result).toEqual([10, 20, 30, 40, 50, 60])
    expect(peak).toBeLessThanOrEqual(2)
  })

  test("stops picking up new items after the first failure", async () => {
    const started: number[] = []
    await expect(
      mapWithBoundedConcurrency([1, 2, 3, 4, 5, 6], 2, async (value) => {
        started.push(value)
        if (value === 1) throw new Error("boom")
        await new Promise((resolve) => setTimeout(resolve, 20))
        return value
      }),
    ).rejects.toThrow("boom")
    expect(started).not.toContain(5)
    expect(started).not.toContain(6)
  })
})
