import { describe, expect, test } from "vitest"
import { execFileSync } from "node:child_process"
import { FanOut } from "../../src/util/fan-out"

describe("FanOut.run", () => {
  test("clamps oversized timeouts so setTimeout does not fire immediately", async () => {
    const result = await FanOut.run({
      members: [1],
      timeoutMs: 3_000_000_000,
      abort: new AbortController().signal,
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        return "ok"
      },
    })
    expect(result[0]?.result).toBe("ok")
  })

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
    expect(result).toEqual([{ error: "timeout: member exceeded 1ms", durationMs: expect.any(Number) }])
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

    expect(result).toEqual([
      { result: 2, durationMs: expect.any(Number) },
      { result: 4, durationMs: expect.any(Number) },
    ])
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

test("an awaited fan-out timeout keeps a standalone Node process alive", () => {
  const source = new URL("../../src/util/fan-out.ts", import.meta.url).href
  const script = `
    import { FanOut } from ${JSON.stringify(source)}
    const result = await FanOut.run({
      members: [1],
      timeoutMs: 20,
      abort: new AbortController().signal,
      execute: () => new Promise(() => {}),
    })
    console.log(result[0].error)
  `
  const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 10_000,
  })
  expect(output).toContain("timeout: member exceeded 20ms")
})

test("does not publish success after execute blocks past its deadline", async () => {
  const [result] = await FanOut.run({
    members: [1],
    timeoutMs: 1,
    abort: new AbortController().signal,
    execute: async () => {
      const until = performance.now() + 20
      while (performance.now() < until) {
        // Keep the event loop occupied so the timeout callback cannot run.
      }
      return "late success"
    },
  })
  expect(result?.error).toBe("timeout: member exceeded 1ms")
  expect(result?.result).toBeUndefined()
})
