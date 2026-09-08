import { describe, expect, test } from "vitest"
import { FanOut } from "../../src/util/fan-out"

describe("FanOut.run", () => {
  test("does not start members when cancellation is already requested", async () => {
    let calls = 0
    const result = await FanOut.run({
      members: [1, 2],
      timeoutMs: 1000,
      abort: AbortSignal.abort(),
      execute: async () => {
        calls++
        return "late success"
      },
    })
    expect(calls).toBe(0)
    expect(result.every((item) => item.error?.startsWith("aborted:"))).toBe(true)
  })

  test("rejects late success and skips queued work when a callback ignores cancellation", async () => {
    const abort = new AbortController()
    let calls = 0
    const result = await FanOut.run({
      members: [1, 2],
      concurrency: 1,
      timeoutMs: 1000,
      abort: abort.signal,
      execute: async () => {
        calls++
        abort.abort()
        return "late success"
      },
    })
    expect(calls).toBe(1)
    expect(result.every((item) => item.error?.startsWith("aborted:"))).toBe(true)
  })

  test("enforces the timeout when a callback ignores its signal", async () => {
    const result = await FanOut.run({
      members: [1],
      timeoutMs: 1,
      abort: new AbortController().signal,
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        return "late success"
      },
    })
    expect(result).toEqual([{ error: "timeout: member exceeded 1ms" }])
  })

  test("retains an empty HTTP failure nested inside an SDK retry error", async () => {
    const transport = Object.assign(new Error(""), {
      name: "AI_APICallError",
      statusCode: 504,
      requestBodyValues: { apiKey: "private-test-value" },
      responseBody: "private-response",
    })
    const retry = Object.assign(new Error("Failed after 3 attempts. Last error: "), { lastError: transport })
    const [result] = await FanOut.run({
      members: [1],
      timeoutMs: 1000,
      abort: new AbortController().signal,
      execute: async () => {
        throw retry
      },
    })
    expect(result?.error).toContain("HTTP 504")
    expect(result?.error).toContain("AI_APICallError")
    expect(result?.error).not.toContain("private")
    transport.cause = retry
    expect(FanOut.describeError(retry)).toContain("HTTP 504")
    expect(FanOut.describeError(new Error(""))).toBe("Error")
  })

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
