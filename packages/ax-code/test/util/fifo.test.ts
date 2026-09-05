import { describe, expect, test } from "vitest"
import { Fifo } from "../../src/util/fifo"

describe("Fifo", () => {
  test("preserves empty-looking values and resets after draining", () => {
    const queue = new Fifo<unknown>()
    for (const value of [undefined, null, false, 0, ""]) queue.push(value)
    expect(queue.size).toBe(5)
    expect(queue.toArray()).toEqual([undefined, null, false, 0, ""])
    for (const value of [undefined, null, false, 0, ""]) expect(queue.shift()).toBe(value)
    expect(queue.size).toBe(0)
    expect(queue.shift()).toBeUndefined()
    queue.push("reused")
    expect(queue.peek()).toBe("reused")
    queue.clear()
    expect(queue.size).toBe(0)
    expect(queue.peek()).toBeUndefined()
  })

  test("preserves FIFO order across repeated prefix compaction and tail copies", () => {
    const queue = new Fifo<number>()
    let next = 0
    let expected = 0
    for (let cycle = 0; cycle < 8; cycle++) {
      for (let i = 0; i < 4096; i++) queue.push(next++)
      const snapshot = queue.toArray()
      for (let i = 0; i < 3072; i++) expect(queue.shift()).toBe(expected++)
      expect(queue.size).toBe(next - expected)
      expect(queue.peek()).toBe(expected)
      expect(queue.toArray(queue.size - 2)).toEqual([next - 2, next - 1])
      expect(snapshot.at(-1)).toBe(next - 1)
      snapshot.length = 0
      expect(queue.size).toBe(next - expected)
    }
    while (queue.size > 0) expect(queue.shift()).toBe(expected++)
    expect(expected).toBe(next)
  })
})
