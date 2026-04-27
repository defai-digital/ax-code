import { describe, expect, test } from "bun:test"
import { dispatch, type DispatchExecutor, type DispatchSpec } from "../../src/dispatch"

function spec(agent: string, prompt = "do thing", overrides: Partial<DispatchSpec> = {}): DispatchSpec {
  return { agent, prompt, ...overrides }
}

describe("dispatch primitive", () => {
  test("empty specs returns empty array", async () => {
    const results = await dispatch([], async () => ({ output: "x" }))
    expect(results).toEqual([])
  })

  test("runs all specs in parallel batches", async () => {
    const concurrent: number[] = []
    let inFlight = 0
    const executor: DispatchExecutor = async (s) => {
      inFlight++
      concurrent.push(inFlight)
      await new Promise((r) => setTimeout(r, 20))
      inFlight--
      return { output: `${s.agent}-done` }
    }

    const results = await dispatch([spec("a"), spec("b"), spec("c"), spec("d")], executor, { maxParallel: 2 })

    expect(results.map((r) => r.agent)).toEqual(["a", "b", "c", "d"])
    expect(results.every((r) => r.status === "completed")).toBe(true)
    // Peak concurrency was at most maxParallel
    expect(Math.max(...concurrent)).toBeLessThanOrEqual(2)
  })

  test("collects per-spec error without affecting siblings", async () => {
    const executor: DispatchExecutor = async (s) => {
      if (s.agent === "bad") throw new Error("kaboom")
      return { output: "ok" }
    }

    const results = await dispatch([spec("good"), spec("bad"), spec("also-good")], executor)

    expect(results[0].status).toBe("completed")
    expect(results[1].status).toBe("failed")
    expect(results[1].error).toBe("kaboom")
    expect(results[2].status).toBe("completed")
  })

  test("per-spec timeout produces status 'timeout'", async () => {
    const executor: DispatchExecutor = async (_, signal) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 1000)
        signal.addEventListener("abort", () => {
          clearTimeout(timer)
          reject(new Error("aborted"))
        })
      })
      return { output: "never" }
    }

    const [result] = await dispatch([spec("slow", "x", { timeoutMs: 20 })], executor)

    expect(result.status).toBe("timeout")
    expect(result.durationMs).toBeGreaterThanOrEqual(15)
  })

  test("parent AbortSignal cancels in-flight subagents and stubs the rest", async () => {
    const ac = new AbortController()
    let started = 0
    const executor: DispatchExecutor = async (_, signal) => {
      started++
      // First batch fires; abort parent to cancel them.
      if (started <= 2) setTimeout(() => ac.abort(), 5)
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 1000)
        signal.addEventListener("abort", () => {
          clearTimeout(timer)
          reject(new Error("aborted"))
        })
      })
      return { output: "x" }
    }

    const results = await dispatch([spec("a"), spec("b"), spec("c"), spec("d")], executor, {
      signal: ac.signal,
      maxParallel: 2,
    })

    expect(results).toHaveLength(4)
    // First two were running and got cancelled
    expect(results[0].status).toBe("cancelled")
    expect(results[1].status).toBe("cancelled")
    // The rest never started
    expect(results[2].status).toBe("cancelled")
    expect(results[3].status).toBe("cancelled")
  })

  test("if parent already aborted at call time, all specs are stubbed cancelled", async () => {
    const ac = new AbortController()
    ac.abort()
    let started = 0
    const executor: DispatchExecutor = async () => {
      started++
      return { output: "x" }
    }

    const results = await dispatch([spec("a"), spec("b")], executor, { signal: ac.signal })

    expect(started).toBe(0)
    expect(results.every((r) => r.status === "cancelled")).toBe(true)
  })

  test("invokes onSubagentStart and onSubagentComplete callbacks", async () => {
    const events: string[] = []
    const executor: DispatchExecutor = async (s) => ({ output: s.agent })

    await dispatch([spec("a"), spec("b")], executor, {
      onSubagentStart: (s) => events.push(`start:${s.agent}`),
      onSubagentComplete: (r) => events.push(`done:${r.agent}:${r.status}`),
    })

    expect(events.sort()).toEqual(["done:a:completed", "done:b:completed", "start:a", "start:b"])
  })

  test("preserves executor output, filesModified, tokensUsed", async () => {
    const executor: DispatchExecutor = async (s) => ({
      output: `${s.agent}-output`,
      filesModified: [`/tmp/${s.agent}.ts`],
      tokensUsed: 123,
    })

    const [result] = await dispatch([spec("a")], executor)

    expect(result.output).toBe("a-output")
    expect(result.filesModified).toEqual(["/tmp/a.ts"])
    expect(result.tokensUsed).toBe(123)
  })

  test("missing optional fields default sensibly", async () => {
    const executor: DispatchExecutor = async () => ({})

    const [result] = await dispatch([spec("a")], executor)

    expect(result.output).toBeUndefined()
    expect(result.filesModified).toEqual([])
    expect(result.tokensUsed).toBe(0)
  })

  test("non-Error throw is stringified", async () => {
    const executor: DispatchExecutor = async () => {
      throw "literal string"
    }

    const [result] = await dispatch([spec("a")], executor)

    expect(result.status).toBe("failed")
    expect(result.error).toBe("literal string")
  })

  test("maxParallel below 1 is clamped", async () => {
    const executor: DispatchExecutor = async (s) => ({ output: s.agent })
    const results = await dispatch([spec("a"), spec("b")], executor, { maxParallel: 0 })
    expect(results).toHaveLength(2)
    expect(results.every((r) => r.status === "completed")).toBe(true)
  })

  test("forwards constraints into the executor's spec view", async () => {
    let received: DispatchSpec | undefined
    const executor: DispatchExecutor = async (s) => {
      received = s
      return { output: "x" }
    }

    await dispatch([spec("a", "do thing", { constraints: ["preserve API"] })], executor)

    expect(received?.constraints).toEqual(["preserve API"])
  })

  test("durationMs is recorded even on failure", async () => {
    const executor: DispatchExecutor = async () => {
      await new Promise((r) => setTimeout(r, 15))
      throw new Error("oops")
    }

    const [result] = await dispatch([spec("a")], executor)

    expect(result.status).toBe("failed")
    expect(result.durationMs).toBeGreaterThanOrEqual(10)
  })
})
