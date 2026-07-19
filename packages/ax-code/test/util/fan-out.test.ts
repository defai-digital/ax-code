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
})
