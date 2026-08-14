import { describe, expect, test } from "vitest"
import { FanOut } from "../../src/util/fan-out"

describe("FanOut.run", () => {
  test("clamps invalid concurrency instead of silently skipping members", async () => {
    const abort = new AbortController()
    const result = await FanOut.run({
      members: [1, 2],
      timeoutMs: 1_000,
      abort: abort.signal,
      concurrency: 0,
      execute: async (member) => member * 2,
    })

    expect(result).toEqual([{ result: 2 }, { result: 4 }])
  })

  test("labels a timer-fired timeout distinctly from an abort", async () => {
    const abort = new AbortController()
    const [result] = await FanOut.run({
      members: [1],
      timeoutMs: 20,
      abort: abort.signal,
      execute: (_member, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("This operation was aborted")), { once: true })
        }),
    })

    expect(result?.error).toMatch(/^timeout: member exceeded 20ms$/)
  })

  test("labels a parent-signal abort as aborted, not timeout", async () => {
    const abort = new AbortController()
    const pending = FanOut.run({
      members: [1],
      timeoutMs: 60_000,
      abort: abort.signal,
      execute: (_member, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("This operation was aborted")), { once: true })
        }),
    })
    abort.abort()
    const [result] = await pending

    expect(result?.error).toMatch(/^aborted: /)
  })
})
