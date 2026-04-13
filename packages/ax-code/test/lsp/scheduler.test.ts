import { afterEach, describe, expect, test } from "bun:test"
import { LspScheduler } from "../../src/lsp/scheduler"
import { Log } from "../../src/util/log"

Log.init({ print: false })

afterEach(() => {
  LspScheduler.Inflight.resetForTest()
  LspScheduler.Budget.resetForTest()
})

// Unit tests for the scheduler primitives added in v2 §S1+S2.
// Exercises Inflight.run and Budget.acquire directly, so LSP state is
// not required. Integration with runWithEnvelope is covered by
// test/lsp/request-collapse.test.ts.

describe("LspScheduler.Inflight", () => {
  test("concurrent identical keys share one execution", async () => {
    let calls = 0
    const fn = async () => {
      calls++
      await new Promise((r) => setTimeout(r, 10))
      return 42
    }

    const [a, b, c] = await Promise.all([
      LspScheduler.Inflight.run("k", fn),
      LspScheduler.Inflight.run("k", fn),
      LspScheduler.Inflight.run("k", fn),
    ])

    expect(calls).toBe(1)
    expect(a).toBe(42)
    expect(b).toBe(42)
    expect(c).toBe(42)
  })

  test("different keys run independently", async () => {
    let calls = 0
    const fn = async () => {
      calls++
      return calls
    }

    const [a, b] = await Promise.all([
      LspScheduler.Inflight.run("k1", fn),
      LspScheduler.Inflight.run("k2", fn),
    ])

    expect(calls).toBe(2)
    expect(new Set([a, b])).toEqual(new Set([1, 2]))
  })

  test("rejection propagates to all waiters and evicts the entry", async () => {
    const err = new Error("boom")
    const fn = async () => {
      throw err
    }

    const results = await Promise.allSettled([
      LspScheduler.Inflight.run("k", fn),
      LspScheduler.Inflight.run("k", fn),
    ])

    expect(results[0].status).toBe("rejected")
    expect(results[1].status).toBe("rejected")
    expect((results[0] as PromiseRejectedResult).reason).toBe(err)
    expect((results[1] as PromiseRejectedResult).reason).toBe(err)

    // After settle, a second run should re-execute.
    let calls = 0
    const ok = async () => {
      calls++
      return "ok"
    }
    const retry = await LspScheduler.Inflight.run("k", ok)
    expect(calls).toBe(1)
    expect(retry).toBe("ok")
  })

  test("sequential calls after settle do re-execute", async () => {
    let calls = 0
    const fn = async () => {
      calls++
      return calls
    }

    const first = await LspScheduler.Inflight.run("k", fn)
    const second = await LspScheduler.Inflight.run("k", fn)

    expect(first).toBe(1)
    expect(second).toBe(2)
    expect(calls).toBe(2)
  })

  test("registry empties after settle", async () => {
    await LspScheduler.Inflight.run("k", async () => 1)
    expect(LspScheduler.Inflight.sizeForTest()).toBe(0)
  })
})

describe("LspScheduler.Budget", () => {
  test("acquires run concurrently up to budget", async () => {
    LspScheduler.Budget.setBudgetForTest("srv", 2)

    const r1 = await LspScheduler.Budget.acquire("srv")
    const r2 = await LspScheduler.Budget.acquire("srv")
    expect(LspScheduler.Budget.inUseForTest("srv")).toBe(2)

    // A third acquire should block. We race it against a short timer
    // to confirm it's pending rather than resolving immediately.
    let acquired = false
    const blocked = LspScheduler.Budget.acquire("srv").then((r) => {
      acquired = true
      return r
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(acquired).toBe(false)

    // Release one slot — blocked acquire should now resolve.
    r1()
    const r3 = await blocked
    expect(acquired).toBe(true)
    expect(LspScheduler.Budget.inUseForTest("srv")).toBe(2)

    r2()
    r3()
    expect(LspScheduler.Budget.inUseForTest("srv")).toBe(0)
  })

  test("different servers do not block each other", async () => {
    LspScheduler.Budget.setBudgetForTest("a", 1)
    LspScheduler.Budget.setBudgetForTest("b", 1)

    const ra = await LspScheduler.Budget.acquire("a")
    // If b were blocked by a, this would hang; the test would time out.
    const rb = await LspScheduler.Budget.acquire("b")

    expect(LspScheduler.Budget.inUseForTest("a")).toBe(1)
    expect(LspScheduler.Budget.inUseForTest("b")).toBe(1)

    ra()
    rb()
  })

  test("release is idempotent", async () => {
    LspScheduler.Budget.setBudgetForTest("srv", 1)
    const r = await LspScheduler.Budget.acquire("srv")
    r()
    r() // second call should be a no-op, not a double-release
    expect(LspScheduler.Budget.inUseForTest("srv")).toBe(0)

    // Budget should still be coherent — we should be able to acquire again.
    const r2 = await LspScheduler.Budget.acquire("srv")
    expect(LspScheduler.Budget.inUseForTest("srv")).toBe(1)
    r2()
  })

  test("setBudgetForTest coerces nonsense values to 1", async () => {
    LspScheduler.Budget.setBudgetForTest("srv", 0)
    const r = await LspScheduler.Budget.acquire("srv")
    expect(LspScheduler.Budget.inUseForTest("srv")).toBe(1)
    r()
  })

  test("FIFO: waiters are woken in arrival order", async () => {
    LspScheduler.Budget.setBudgetForTest("srv", 1)
    const held = await LspScheduler.Budget.acquire("srv")

    const order: number[] = []
    const waitA = LspScheduler.Budget.acquire("srv").then((r) => {
      order.push(1)
      return r
    })
    const waitB = LspScheduler.Budget.acquire("srv").then((r) => {
      order.push(2)
      return r
    })
    const waitC = LspScheduler.Budget.acquire("srv").then((r) => {
      order.push(3)
      return r
    })

    // Release the initial holder — waiter A should wake first.
    held()
    const ra = await waitA
    ra()
    const rb = await waitB
    rb()
    const rc = await waitC
    rc()

    expect(order).toEqual([1, 2, 3])
  })
})
